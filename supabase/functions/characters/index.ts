import {
  createApp,
  getSupabaseClient,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = createApp();

const characterParamsSchema = z.object({
  id: z.uuid(),
});

const createCharacterSchema = z.object({
  name: z.string().min(1),
  bio: z.string().optional(),
  avatar: z.string().optional(),
  originPrompt: z.string().optional(),
  isPublic: z.boolean().optional(),
});

const updateCharacterSchema = z.object({
  name: z.string().min(1).optional(),
  bio: z.string().optional(),
  avatar: z.string().optional(),
  originPrompt: z.string().optional(),
  isPublic: z.boolean().optional(),
});

const addKnowledgeBaseSchema = z.object({
  knowledgeBaseId: z.uuid(),
  priority: z.number().int().default(0),
});

const knowledgeBaseParamsSchema = z.object({
  id: z.uuid(),
  kbId: z.uuid(),
});

// GET /characters 获取角色列表
app.get("/characters", async (c) => {
  const supabase = getSupabaseClient(c.req.raw);
  const page = Number(c.req.query("page") || "1");
  const limit = Number(c.req.query("limit") || "20");
  const search = c.req.query("search");
  const offset = (page - 1) * limit;

  let query = supabase
    .from("characters")
    .select("*, author:profiles!characters_author_id_fkey(*)", {
      count: "exact",
    })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("uid", user.id)
      .single();

    if (profile) {
      query = query.or(`is_public.eq.true,author_id.eq.${profile.id}`);
    } else {
      query = query.eq("is_public", true);
    }
  } else {
    query = query.eq("is_public", true);
  }

  const { data: characters, error, count } = await query;

  if (error) {
    throw error;
  }

  return c.json({
    success: true,
    message: "获取角色列表成功",
    data: {
      characters: characters.map((char) => ({
        id: char.id,
        creatorId: char.author?.id,
        name: char.name,
        signature: char.bio,
        persona: char.origin_prompt,
        avatarUrl: char.avatar,
        isPublic: char.is_public,
        createdAt: char.created_at,
        updatedAt: char.updated_at,
        author: char.author
          ? {
              id: char.author.id,
              uid: char.author.uid,
              name: char.author.username,
              avatar: char.author.avatar,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: page * limit < (count || 0),
        hasPrev: page > 1,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /characters 创建角色
app.post(
  "/characters",
  authMiddleware,
  profileMiddleware,
  zValidator("json", createCharacterSchema, (result, c) => {
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
    const { name, bio, avatar, originPrompt, isPublic } = body;

    const { data: char, error } = await supabase
      .from("characters")
      .insert({
        author_id: profile.id,
        name,
        bio,
        origin_prompt: originPrompt,
        avatar,
        is_public: isPublic ?? false,
      })
      .select("*, author:profiles!characters_author_id_fkey(*)")
      .single();

    if (error) throw error;

    return c.json(
      {
        success: true,
        message: "角色创建成功",
        data: {
          id: char.id,
          name: char.name,
          bio: char.bio,
          originPrompt: char.origin_prompt,
          avatar: char.avatar,
          isPublic: char.is_public,
          authorId: char.author.id,
          createdAt: char.created_at,
          updatedAt: char.updated_at,
          author: {
            id: char.author.id,
            uid: char.author.uid,
            avatar: char.author.avatar,
            name: char.author.username,
          },
        },
      },
      201
    );
  }
);

// GET /characters/:id 获取角色详情
app.get(
  "/characters/:id",
  zValidator("param", characterParamsSchema, (result, c) => {
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
    const { id } = c.req.valid("param");

    const { data: char, error } = await supabase
      .from("characters")
      .select("*, author:profiles!characters_author_id_fkey(*)")
      .eq("id", id)
      .single();

    if (error || !char) {
      return c.json(
        {
          success: false,
          error: { message: "Character not found", code: "NOT_FOUND" },
        },
        404
      );
    }

    return c.json({
      success: true,
      message: "成功获取角色详情",
      data: {
        id: char.id,
        name: char.name,
        bio: char.bio,
        originPrompt: char.origin_prompt,
        avatar: char.avatar,
        isPublic: char.is_public,
        creatorId: char.author.id,
        authorId: char.author.id,
        createdAt: char.created_at,
        updatedAt: char.updated_at,
        author: {
          id: char.author.id,
          uid: char.author.uid,
          avatar: char.author.avatar,
          name: char.author.username,
        },
      },
    });
  }
);

// PUT /characters/:id 更新角色
app.put(
  "/characters/:id",
  authMiddleware,
  zValidator("param", characterParamsSchema, (result, c) => {
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
  zValidator("json", updateCharacterSchema, (result, c) => {
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
    const { id } = c.req.valid("param");

    const body = c.req.valid("json");

    const { data: char, error } = await supabase
      .from("characters")
      .update({
        name: body.name,
        bio: body.bio,
        origin_prompt: body.originPrompt,
        avatar: body.avatar,
        is_public: body.isPublic,
      })
      .eq("id", id)
      .select("*, author:profiles!characters_author_id_fkey(*)")
      .single();

    if (error) throw error;

    return c.json({
      success: true,
      message: "角色更新成功",
      data: {
        id: char.id,
        name: char.name,
        bio: char.bio,
        originPrompt: char.origin_prompt,
        avatar: char.avatar,
        isPublic: char.is_public,
        creatorId: char.author.id,
        authorId: char.author.id,
        createdAt: char.created_at,
        updatedAt: char.updated_at,
        author: {
          id: char.author.id,
          uid: char.author.uid,
          avatar: char.author.avatar,
          name: char.author.username,
        },
      },
    });
  }
);

// DELETE /characters/:id 删除角色
app.delete(
  "/characters/:id",
  authMiddleware,
  zValidator("param", characterParamsSchema, (result, c) => {
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
    const { id } = c.req.valid("param");

    const { error } = await supabase.from("characters").delete().eq("id", id);

    if (error) throw error;

    return c.json({
      success: true,
      message: "角色删除成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

// GET /characters/:id/knowledge-bases 获取角色关联的知识库
app.get(
  "/characters/:id/knowledge-bases",
  zValidator("param", characterParamsSchema, (result, c) => {
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
    const { id } = c.req.valid("param");

    const { data, error } = await supabase
      .from("knowledge_subscriptions")
      .select("*, knowledge_base:knowledge_bases(*)")
      .eq("character_id", id)
      .order("priority", { ascending: false });

    if (error) throw error;

    return c.json({
      success: true,
      message: "获取关联知识库成功",
      data: data.map((item) => ({
        knowledgeBase: item.knowledge_base,
        priority: item.priority,
      })),
      timestamp: new Date().toISOString(),
    });
  }
);

// POST /characters/:id/knowledge-bases 关联知识库
app.post(
  "/characters/:id/knowledge-bases",
  authMiddleware,
  zValidator("param", characterParamsSchema, (result, c) => {
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
  zValidator("json", addKnowledgeBaseSchema, (result, c) => {
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
    const { id } = c.req.valid("param");
    const { knowledgeBaseId, priority } = c.req.valid("json");

    const { error } = await supabase.rpc("link_knowledge_base_to_ai", {
      p_character_id: id,
      p_knowledge_base_id: knowledgeBaseId,
      p_priority: priority,
    });

    if (error) throw error;

    return c.json(
      {
        success: true,
        message: "关联知识库成功",
        data: null,
        timestamp: new Date().toISOString(),
      },
      201
    );
  }
);

// DELETE /characters/:id/knowledge-bases/:kbId 取消关联知识库
app.delete(
  "/characters/:id/knowledge-bases/:kbId",
  authMiddleware,
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
    const { id, kbId } = c.req.valid("param");

    const { error } = await supabase.rpc("unlink_knowledge_base_from_ai", {
      p_character_id: id,
      p_knowledge_base_id: kbId,
    });

    if (error) throw error;

    return c.json({
      success: true,
      message: "取消关联知识库成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

Deno.serve(app.fetch);
