import { createClient } from "@supabase/supabase-js";
import { Document } from "langchain";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { JSONLoader } from "@langchain/classic/document_loaders/fs/json";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { type Database } from "./database.types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("LOCAL_DEV_SUPABASE_URL") ?? "http://kong:8000";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("LOCAL_DEV_SERVICE_ROLE_KEY") ??
  "";
const POLL_INTERVAL_MS = Number(Deno.env.get("POLL_INTERVAL_MS") ?? "10000");
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
const DASHSCOPE_API_BASE_URL = Deno.env.get("DASHSCOPE_API_BASE_URL") ??
  undefined;

if (!SERVICE_ROLE_KEY) {
  console.error("[embedding-worker] SERVICE_ROLE_KEY is required");
  Deno.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseFileContent(
  content: Blob,
  fileType: string,
  fileName: string,
): Promise<Document[]> {
  const mimeType = fileType.toLowerCase();

  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    const loader = new WebPDFLoader(content, { splitPages: true });
    return await loader.load();
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const loader = new DocxLoader(content);
    return await loader.load();
  }

  if (mimeType === "text/csv" || fileName.endsWith(".csv")) {
    const loader = new CSVLoader(content);
    return await loader.load();
  }

  if (mimeType === "application/json" || fileName.endsWith(".json")) {
    const loader = new JSONLoader(content);
    return await loader.load();
  }

  if (mimeType === "text/html" || fileName.endsWith(".html")) {
    const text = await content.text();
    const plainText = text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [
      new Document({
        pageContent: plainText,
        metadata: { source: fileName, type: "html" },
      }),
    ];
  }

  const loader = new TextLoader(content);
  return await loader.load();
}

async function processOne(): Promise<void> {
  const { data: fileRecord, error: fetchError } = await supabase
    .from("knowledge_files")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (fetchError || !fileRecord) {
    console.log("[embedding-worker] queue empty");
    return;
  }

  await supabase
    .from("knowledge_files")
    .update({ status: "processing" })
    .eq("id", fileRecord.id);

  const { data: downloaded, error: downloadError } = await supabase.storage
    .from("knowledge_files")
    .download(fileRecord.file_path);

  if (downloadError || !downloaded) {
    console.error("[embedding-worker] download failed", downloadError);
    await supabase
      .from("knowledge_files")
      .update({ status: "failed", error_message: String(downloadError) })
      .eq("id", fileRecord.id);
    return;
  }

  let content: string | Blob = downloaded as Blob;
  if (fileRecord.file_type?.startsWith("text/")) {
    content = await (downloaded as Blob).text();
  }

  try {
    let parsedDocs: Document[];
    if (typeof content === "string") {
      parsedDocs = [
        new Document({
          pageContent: content,
          metadata: {
            fileName: fileRecord.file_name,
            source: fileRecord.file_path,
            type: "text",
          },
        }),
      ];
    } else {
      const fileType = (content as Blob).type || "text/plain";
      const loaded = await parseFileContent(
        content as Blob,
        fileType,
        fileRecord.file_name,
      );
      parsedDocs = loaded.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          fileName: fileRecord.file_name,
          source: fileRecord.file_path,
        },
      }));
    }

    const totalContent = parsedDocs.map((doc) => doc.pageContent).join("\n\n");
    if (!totalContent.length) {
      throw new Error("No content to process after parsing");
    }

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ["\n\n", "\n", "。", "！", "？", ".", "!", "?", " ", ""],
    });

    const doc = new Document({
      pageContent: totalContent,
      metadata: {
        fileName: fileRecord.file_name,
        source: fileRecord.file_path,
        pageCount: parsedDocs.length,
      },
    });

    const splitDocs: Document[] = await textSplitter.splitDocuments([doc]);
    if (!splitDocs.length) {
      throw new Error("No content to process after splitting");
    }

    const embeddings = new OpenAIEmbeddings({
      model: "text-embedding-v4",
      apiKey: DASHSCOPE_API_KEY,
      dimensions: 1024,
      batchSize: 10,
      configuration: {
        baseURL: DASHSCOPE_API_BASE_URL,
      },
    });

    const texts = splitDocs.map((d: Document) => d.pageContent);
    const vectors = await embeddings.embedDocuments(texts);

    const documentsToInsert = splitDocs.map((
      splitDoc: Document,
      index: number,
    ) => ({
      knowledge_base_id: fileRecord.knowledge_base_id,
      file_id: fileRecord.id,
      content: splitDoc.pageContent,
      metadata: {
        ...splitDoc.metadata,
        chunkIndex: index,
        totalChunks: splitDocs.length,
      },
      embedding: JSON.stringify(vectors[index]),
    }));

    const { error: docError } = await supabase
      .from("knowledge_documents")
      .insert(documentsToInsert);

    if (docError) throw docError;

    await supabase
      .from("knowledge_files")
      .update({ status: "completed" })
      .eq("id", fileRecord.id);

    console.log(
      `[embedding-worker] processed file ${fileRecord.id}, chunks=${splitDocs.length}`,
    );
  } catch (e) {
    console.error("[embedding-worker] processing failed", e);
    await supabase
      .from("knowledge_files")
      .update({ status: "failed", error_message: String(e) })
      .eq("id", fileRecord.id);
  }
}

async function loop() {
  console.log(
    `[embedding-worker] polling ${SUPABASE_URL} every ${POLL_INTERVAL_MS}ms with service key`,
  );
  while (true) {
    await processOne();
    await sleep(POLL_INTERVAL_MS);
  }
}

loop();
