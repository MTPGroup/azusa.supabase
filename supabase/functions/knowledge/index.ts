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

function makeSafeStorageFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const replacedSpaces = trimmed.replace(/\s+/g, "_");
  const cleaned = replacedSpaces.replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned.length > 0 ? cleaned : "file";
}

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
        400,
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
      201,
    );
  },
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
        404,
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
  },
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
          errorMessage: f.error_message,
          createdAt: f.created_at,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  },
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
        400,
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
        404,
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
  },
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
        404,
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
  },
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
        400,
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
        404,
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
          400,
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
          400,
        );
      }
      content = result.data.content;
      metadata = result.data.metadata || {};
      fileName = (metadata.fileName as string) || `doc_${Date.now()}.txt`;
    }

    // 上传到 Supabase Storage (备份原始文件)
    const safeFileName = makeSafeStorageFileName(fileName);
    const storagePath = `${kbId}/${Date.now()}_${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from("knowledge_files")
      .upload(storagePath, content, {
        contentType: content instanceof Blob
          ? content.type
          : "text/plain;charset=UTF-8",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload to Supabase Storage:", uploadError);
      return c.json(
        {
          success: false,
          error: { message: "Failed to upload file to storage" },
        },
        500,
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
        status: "pending",
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
        500,
      );
    }

    // 不在请求内处理长任务，标记为排队
    await supabase
      .from("knowledge_files")
      .update({ status: "pending" })
      .eq("id", fileRecord.id);

    return c.json(
      {
        success: true,
        message: "文档已排队等待处理",
        data: { file: fileRecord },
        timestamp: new Date().toISOString(),
      },
      202,
    );
  },
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
        400,
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
        },
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
        500,
      );
    }
  },
);

Deno.serve(app.fetch);
