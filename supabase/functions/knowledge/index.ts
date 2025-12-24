import {
  authMiddleware,
  createApp,
  getSupabaseClient,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Document } from "langchain";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { JSONLoader } from "@langchain/classic/document_loaders/fs/json";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";

/**
 * 解析文件内容，支持多种文件格式
 * 支持: PDF, DOCX, PPTX, CSV, JSON, TXT, MD, HTML 等
 */
async function parseFileContent(
  content: Blob,
  fileType: string,
  fileName: string
): Promise<Document[]> {
  const mimeType = fileType.toLowerCase();

  // PDF 文件 - 使用 WebPDFLoader (支持 Web 环境)
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    const loader = new WebPDFLoader(content, {
      splitPages: true,
    });
    return await loader.load();
  }

  // DOCX 文件 - 使用 LangChain DocxLoader
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const loader = new DocxLoader(content);
    return await loader.load();
  }

  // PPTX 文件 - 使用 LangChain PPTXLoader
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fileName.endsWith(".pptx")
  ) {
    throw new Error("不支持 .pptx 格式");
  }

  // CSV 文件 - 使用 LangChain CSVLoader
  if (mimeType === "text/csv" || fileName.endsWith(".csv")) {
    const loader = new CSVLoader(content);
    return await loader.load();
  }

  // JSON 文件 - 使用 LangChain JSONLoader
  if (mimeType === "application/json" || fileName.endsWith(".json")) {
    const loader = new JSONLoader(content);
    return await loader.load();
  }

  // DOC 文件 (旧版 Word) - 暂不支持
  if (mimeType === "application/msword" || fileName.endsWith(".doc")) {
    throw new Error("不支持 .doc 格式，请转换为 .docx 或 .pdf 后重新上传");
  }

  // PPT 文件 (旧版 PowerPoint) - 暂不支持
  if (
    mimeType === "application/vnd.ms-powerpoint" ||
    fileName.endsWith(".ppt")
  ) {
    throw new Error("不支持 .ppt 格式");
  }

  // HTML 文件
  if (mimeType === "text/html" || fileName.endsWith(".html")) {
    const text = await content.text();
    // 简单的 HTML 标签移除
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

  // 默认使用 TextLoader (TXT, MD 等纯文本文件)
  const loader = new TextLoader(content);
  return await loader.load();
}

// Supabase Edge Runtime 全局类型声明
declare const EdgeRuntime:
  | {
      waitUntil: (promise: Promise<unknown>) => void;
    }
  | undefined;

const app = createApp();

const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isPublic: z.boolean().default(false),
});

const updateKnowledgeBaseSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
});

const addDocumentSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.any(), z.any()).optional(),
});

const searchKnowledgeSchema = z.object({
  query: z.string().min(1),
  knowledgeBaseIds: z.array(z.string()).min(1),
  threshold: z.number().optional().default(0.5),
  limit: z.number().optional().default(5),
});

const knowledgeBaseParamsSchema = z.object({
  id: z.uuid(),
});

// GET /knowledge/bases 获取知识库列表
app.get("/knowledge/bases", async (c) => {
  const supabase = getSupabaseClient(c.req.raw);
  const isPublic = c.req.query("public") === "true";
  const authorId = c.req.query("authorId");

  let query = supabase
    .from("knowledge_bases")
    .select("*, author:profiles(username, avatar)")
    .order("created_at", { ascending: false });

  if (isPublic) {
    query = query.eq("is_public", true);
  }

  if (authorId) {
    query = query.eq("author_id", authorId);
  }

  const { data: bases, error } = await query;

  if (error) throw error;

  return c.json({
    success: true,
    message: "成功获取知识库列表",
    data: {
      knowledgeBases: bases.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        isPublic: kb.is_public,
        author: {
          id: kb.author_id,
          username: kb.author?.username,
          avatar: kb.author?.avatar,
        },
        createdAt: kb.created_at,
        updatedAt: kb.updated_at,
      })),
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /knowledge/bases 创建知识库
app.post(
  "/knowledge/bases",
  authMiddleware,
  profileMiddleware,
  zValidator("json", createKnowledgeBaseSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");

    const body = c.req.valid("json");

    // 在数据库创建记录
    const { data: kb, error } = await supabase
      .from("knowledge_bases")
      .insert({
        name: body.name,
        description: body.description,
        is_public: body.isPublic,
        author_id: profile.id,
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(
      {
        success: true,
        message: "知识库创建成功",
        data: { knowledgeBase: kb },
        timestamp: new Date().toISOString(),
      },
      201
    );
  }
);

// GET /knowledge/bases/:id 获取单一知识库详情
app.get(
  "/knowledge/bases/:id",
  zValidator("param", knowledgeBaseParamsSchema),
  async (c) => {
    const supabase = getSupabaseClient(c.req.raw);
    const { id: kbId } = c.req.valid("param");

    const { data: kb, error } = await supabase
      .from("knowledge_bases")
      .select("*, author:profiles(username, avatar)")
      .eq("id", kbId)
      .single();

    if (error || !kb) {
      return c.json(
        { success: false, error: { message: "知识库不存在" } },
        404
      );
    }

    return c.json({
      success: true,
      message: "成功获取知识库详情",
      data: {
        knowledgeBase: {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          isPublic: kb.is_public,
          author: {
            id: kb.author_id,
            username: kb.author?.username,
            avatar: kb.author?.avatar,
          },
          createdAt: kb.created_at,
          updatedAt: kb.updated_at,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// GET /knowledge/bases/:id/files 获取知识库下的文件列表
app.get(
  "/knowledge/bases/:id/files",
  zValidator("param", knowledgeBaseParamsSchema),
  async (c) => {
    const supabase = getSupabaseClient(c.req.raw);
    const { id: kbId } = c.req.valid("param");

    const { data: files, error } = await supabase
      .from("knowledge_files")
      .select("*")
      .eq("knowledge_base_id", kbId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return c.json({
      success: true,
      message: "成功获取文件列表",
      data: {
        files: files.map((f) => ({
          id: f.id,
          fileName: f.file_name,
          filePath: f.file_path,
          fileSize: f.file_size,
          fileType: f.file_type,
          status: f.status,
          chunkCount: f.chunk_count,
          errorMessage: f.error_message,
          createdAt: f.created_at,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// PATCH /knowledge/bases/:id 更新知识库
app.patch(
  "/knowledge/bases/:id",
  authMiddleware,
  profileMiddleware,
  zValidator("param", knowledgeBaseParamsSchema),
  zValidator("json", updateKnowledgeBaseSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const { id: kbId } = c.req.valid("param");
    const body = c.req.valid("json");

    // 验证权限
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("author_id")
      .eq("id", kbId)
      .single();

    if (!kb) {
      return c.json(
        { success: false, error: { message: "Knowledge base not found" } },
        404
      );
    }

    if (kb.author_id !== profile?.id) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    // 更新数据库
    const { data: updatedKb, error } = await supabase
      .from("knowledge_bases")
      .update({
        name: body.name,
        description: body.description,
        is_public: body.isPublic,
        updated_at: new Date().toISOString(),
      })
      .eq("id", kbId)
      .select()
      .single();

    if (error) throw error;

    return c.json({
      success: true,
      message: "知识库更新成功",
      data: { knowledgeBase: updatedKb },
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /knowledge/bases/:id 删除知识库
app.delete(
  "/knowledge/bases/:id",
  authMiddleware,
  profileMiddleware,
  zValidator("param", knowledgeBaseParamsSchema),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const { id: kbId } = c.req.valid("param");

    // 验证权限
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("author_id")
      .eq("id", kbId)
      .single();

    if (!kb) {
      return c.json(
        { success: false, error: { message: "Knowledge base not found" } },
        404
      );
    }

    if (kb.author_id !== profile?.id) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    // 删除数据库记录 (级联删除会处理 documents)
    const { error } = await supabase
      .from("knowledge_bases")
      .delete()
      .eq("id", kbId);

    if (error) throw error;

    // 异步清理 Storage 中的文件
    try {
      const { data: files, error: listError } = await supabase.storage
        .from("knowledge_files")
        .list(kbId);

      if (listError) {
        console.error("Failed to list files in storage:", listError);
      } else if (files && files.length > 0) {
        const paths = files.map((file) => `${kbId}/${file.name}`);
        console.log("Removing files from storage:", paths);
        const { error: removeError } = await supabase.storage
          .from("knowledge_files")
          .remove(paths);

        if (removeError) {
          console.error("Failed to remove files from storage:", removeError);
        }
      }
    } catch (error) {
      console.error("Failed to clean up knowledge files from storage:", error);
    }

    return c.json({
      success: true,
      message: "知识库删除成功",
      timestamp: new Date().toISOString(),
    });
  }
);

// POST /knowledge/bases/:id/documents 添加文档
app.post(
  "/knowledge/bases/:id/documents",
  authMiddleware,
  profileMiddleware,
  zValidator("param", knowledgeBaseParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const { id: kbId } = c.req.valid("param");

    // 验证权限：必须是作者
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("author_id")
      .eq("id", kbId)
      .single();
    if (!kb) {
      return c.json(
        { success: false, error: { message: "Knowledge base not found" } },
        404
      );
    }

    if (kb.author_id !== profile?.id) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    // 处理文件上传或 JSON 内容
    let content: string | Blob;
    let fileName: string;
    let metadata: Record<string, unknown> = {};

    const contentType = c.req.header("Content-Type") || "";

    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || !(file instanceof File)) {
        return c.json(
          { success: false, error: { message: "File is required" } },
          400
        );
      }
      content = file;
      fileName = file.name;
      if (body["metadata"]) {
        try {
          metadata = JSON.parse(body["metadata"] as string);
        } catch (_) {
          // ignore invalid metadata json
        }
      }
    } else {
      // JSON 模式 (兼容旧接口)
      const body = await c.req.json();
      const result = addDocumentSchema.safeParse(body);
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: {
              message: "Validation Error",
              details: result.error,
            },
          },
          400
        );
      }
      content = result.data.content;
      metadata = result.data.metadata || {};
      fileName = (metadata.fileName as string) || `doc_${Date.now()}.txt`;
    }

    // 上传到 Supabase Storage (备份原始文件)
    const storagePath = `${kbId}/${Date.now()}_${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("knowledge_files")
      .upload(storagePath, content, {
        contentType:
          content instanceof Blob ? content.type : "text/plain;charset=UTF-8",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload to Supabase Storage:", uploadError);
      return c.json(
        {
          success: false,
          error: { message: "Failed to upload file to storage" },
        },
        500
      );
    }

    // 记录文件信息
    const { data: fileRecord, error: fileError } = await supabase
      .from("knowledge_files")
      .insert({
        knowledge_base_id: kbId,
        file_path: storagePath,
        file_name: fileName,
        file_size: content instanceof Blob ? content.size : content.length,
        file_type: content instanceof Blob ? content.type : "text/plain",
        status: "processing", // 标记为处理中
      })
      .select()
      .single();

    if (fileError) {
      console.error("Failed to insert file record:", fileError);
      return c.json(
        {
          success: false,
          error: { message: "Failed to record file info" },
        },
        500
      );
    }

    // 后台异步处理：使用 LangChain 进行文本分块和嵌入生成
    // 使用 EdgeRuntime.waitUntil 确保后台任务在响应返回后继续执行
    const processDocumentTask = async () => {
      try {
        let parsedDocs: Document[];

        if (typeof content === "string") {
          // 纯文本内容
          parsedDocs = [
            new Document({
              pageContent: content,
              metadata: {
                ...metadata,
                fileName,
                source: storagePath,
                type: "text",
              },
            }),
          ];
        } else {
          // 解析文件内容（支持 PDF、DOCX、HTML 等）
          const fileType = content.type || "text/plain";
          console.log(`Parsing file: ${fileName}, type: ${fileType}`);

          try {
            parsedDocs = await parseFileContent(content, fileType, fileName);
            // 添加额外的元数据
            parsedDocs = parsedDocs.map((doc) => ({
              ...doc,
              metadata: {
                ...doc.metadata,
                ...metadata,
                fileName,
                source: storagePath,
              },
            }));
          } catch (parseError) {
            console.error("Failed to parse file:", parseError);
            throw new Error(`文件解析失败: ${parseError}`);
          }
        }

        // 合并所有文档的文本内容
        const totalContent = parsedDocs
          .map((doc) => doc.pageContent)
          .join("\n\n");
        console.log(
          `Parsed ${parsedDocs.length} pages, total ${totalContent.length} characters`
        );

        if (totalContent.length === 0) {
          throw new Error("No content to process after parsing");
        }

        // 使用 LangChain RecursiveCharacterTextSplitter 进行智能分块
        // 它会尝试保持段落、句子的完整性
        const textSplitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200, // 重叠有助于保持上下文连贯性
          separators: ["\n\n", "\n", "。", "！", "？", ".", "!", "?", " ", ""],
        });

        // 创建合并后的 Document 对象
        const doc = new Document({
          pageContent: totalContent,
          metadata: {
            ...metadata,
            fileName,
            source: storagePath,
            pageCount: parsedDocs.length,
          },
        });

        // 分割文档
        const splitDocs = await textSplitter.splitDocuments([doc]);
        console.log(`Split document into ${splitDocs.length} chunks`);

        if (splitDocs.length === 0) {
          throw new Error("No content to process after splitting");
        }

        // 使用 LangChain OpenAIEmbeddings 生成向量
        const embeddings = new OpenAIEmbeddings({
          model: "text-embedding-v4",
          apiKey: Deno.env.get("DASHSCOPE_API_KEY") || "",
          dimensions: 1024,
          configuration: {
            baseURL: Deno.env.get("DASHSCOPE_API_BASE_URL") || undefined,
          },
        });

        // 批量生成嵌入向量
        const texts = splitDocs.map((doc) => doc.pageContent);
        const vectors = await embeddings.embedDocuments(texts);

        // 批量插入文档切片
        // 注意：pgvector 需要将向量转换为字符串格式 "[0.1, 0.2, ...]"
        const documentsToInsert = splitDocs.map((splitDoc, index) => ({
          knowledge_base_id: kbId,
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

        // 更新文件状态为完成
        await supabase
          .from("knowledge_files")
          .update({
            status: "completed",
            chunk_count: splitDocs.length,
          })
          .eq("id", fileRecord.id);

        console.log(
          `Successfully processed document: ${fileName}, ${splitDocs.length} chunks`
        );
      } catch (e) {
        console.error("Failed to process document:", e);
        await supabase
          .from("knowledge_files")
          .update({ status: "failed", error_message: String(e) })
          .eq("id", fileRecord.id);
      }
    };

    // 使用 EdgeRuntime.waitUntil 在后台执行任务（如果可用）
    // 这样可以立即返回响应，同时继续处理文档
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processDocumentTask());
    } else {
      // 如果不支持 waitUntil，则同步执行
      await processDocumentTask();
    }

    return c.json(
      {
        success: true,
        message: "文档已上传并开始处理",
        data: { file: fileRecord },
        timestamp: new Date().toISOString(),
      },
      201
    );
  }
);

// POST /knowledge/search 搜索知识 (Vector Search)
app.post(
  "/knowledge/search",
  zValidator("json", searchKnowledgeSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = getSupabaseClient(c.req.raw);
    const body = c.req.valid("json");

    const { query, knowledgeBaseIds, limit, threshold } = body;

    try {
      // 生成查询向量
      const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-v4",
        apiKey: Deno.env.get("DASHSCOPE_API_KEY") || "",
        dimensions: 1024,
        configuration: {
          baseURL: Deno.env.get("DASHSCOPE_API_BASE_URL") || undefined,
        },
      });
      const queryEmbedding = await embeddings.embedQuery(query);

      // 调用 RPC 进行向量搜索
      const { data: documents, error } = await supabase.rpc(
        "match_knowledge_documents",
        {
          query_embedding: JSON.stringify(queryEmbedding),
          match_threshold: threshold,
          match_count: limit,
          knowledge_base_ids: knowledgeBaseIds,
        }
      );

      if (error) throw error;

      return c.json({
        success: true,
        message: "搜索成功",
        data: {
          documents: documents.map((doc) => ({
            id: doc.id,
            content: doc.content,
            similarity: doc.similarity,
            metadata: doc.metadata,
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Vector search failed:", e);
      return c.json(
        { success: false, error: { message: "Vector search failed" } },
        500
      );
    }
  }
);

Deno.serve(app.fetch);
