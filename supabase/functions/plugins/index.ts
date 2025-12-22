import {
  createApp,
  getSupabaseClient,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = createApp();

const pluginParamsSchema = z.object({
  id: z.uuid(),
});

const createPluginSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  schema: z.record(z.any(), z.any()),
  code: z.string(),
});

// GET /plugins 获取插件列表
app.get("/plugins", async (c) => {
  const supabase = getSupabaseClient(c.req.raw);
  const status = c.req.query("status");
  const authorId = c.req.query("authorId");

  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = userData?.user?.id
    ? await supabase
        .from("profiles")
        .select("id")
        .eq("uid", userData.user.id)
        .single()
    : { data: null };

  let query = supabase
    .from("plugins")
    .select(
      "*, author:profiles!plugins_author_id_fkey(username, avatar), is_liked:plugin_likes!left(user_id), is_subscribed:plugin_subscriptions!left(user_id)"
    )
    .order("created_at", { ascending: false });

  if (profile) {
    // Filter joins for the current user
    query = query.eq("plugin_likes.user_id", profile.id);
    query = query.eq("plugin_subscriptions.user_id", profile.id);
  }

  if (status) {
    query = query.eq("status", status);
  } else {
    // 默认只显示已批准的，除非指定了 authorId (查看自己的)
    if (!authorId) {
      query = query.eq("status", "approved");
    }
  }

  if (authorId) {
    query = query.eq("author_id", authorId);
  }

  const { data: plugins, error } = await query;

  if (error) throw error;

  return c.json({
    success: true,
    message: "成功获取插件列表",
    data: {
      plugins: plugins.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        version: p.version,
        liked: p.liked,
        isLiked: !!p.is_liked?.length,
        isSubscribed: !!p.is_subscribed?.length,
        status: p.status,
        schema: p.schema,
        code: p.code,
        author: {
          id: p.author_id,
          username: p.author.username,
          avatar: p.author.avatar,
        },
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /plugins 创建插件
app.post(
  "/plugins",
  authMiddleware,
  profileMiddleware,
  zValidator("json", createPluginSchema, (result, c) => {
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

    const { data: plugin, error } = await supabase
      .from("plugins")
      .insert({
        ...body,
        author_id: profile.id,
        status: "pending", // 默认为待审核
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(
      {
        success: true,
        message: "插件创建成功",
        data: { plugin },
        timestamp: new Date().toISOString(),
      },
      201
    );
  }
);

// GET /plugins/:id 获取插件详情
app.get(
  "/plugins/:id",
  zValidator("param", pluginParamsSchema, (result, c) => {
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

    const { data: plugin, error } = await supabase
      .from("plugins")
      .select("*, author:profiles!plugins_author_id_fkey(username, avatar)")
      .eq("id", id)
      .single();

    if (error || !plugin)
      return c.json(
        { success: false, error: { message: "Plugin not found" } },
        404
      );

    return c.json({
      success: true,
      message: "成功获取插件详情",
      data: {
        plugin: {
          ...plugin,
          author: {
            id: plugin.author_id,
            username: plugin.author?.username,
            avatar: plugin.author?.avatar,
          },
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// POST /plugins/:id/subscribe 订阅插件
app.post(
  "/plugins/:id/subscribe",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema, (result, c) => {
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
    const { id: pluginId } = c.req.valid("param");

    const { error } = await supabase.from("plugin_subscriptions").upsert({
      user_id: profile.id,
      plugin_id: pluginId,
      is_active: true,
    });

    if (error) return c.json({ success: false, error }, 500);

    return c.json({
      success: true,
      message: "订阅成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /plugins/:id/subscribe 取消订阅
app.delete(
  "/plugins/:id/subscribe",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema, (result, c) => {
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
    const { id: pluginId } = c.req.valid("param");

    const { error } = await supabase
      .from("plugin_subscriptions")
      .delete()
      .match({ user_id: profile.id, plugin_id: pluginId });

    if (error) throw error;

    return c.json({
      success: true,
      message: "取消订阅成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

// POST /plugins/:id/like 点赞插件
app.post(
  "/plugins/:id/like",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema, (result, c) => {
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
    const { id: pluginId } = c.req.valid("param");

    const { error } = await supabase.from("plugin_likes").insert({
      user_id: profile.id,
      plugin_id: pluginId,
    });

    if (error) {
      if (error.code === "23505") {
        // Unique violation
        return c.json({ success: true, message: "已点赞过" });
      }
      throw error;
    }

    return c.json({
      success: true,
      message: "点赞成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /plugins/:id/like 取消点赞
app.delete(
  "/plugins/:id/like",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema, (result, c) => {
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
    const { id: pluginId } = c.req.valid("param");

    const { error } = await supabase
      .from("plugin_likes")
      .delete()
      .match({ user_id: profile.id, plugin_id: pluginId });

    if (error) throw error;

    return c.json({
      success: true,
      message: "取消点赞成功",
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
);

// PUT /plugins/:id 更新插件
app.put(
  "/plugins/:id",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema),
  zValidator("json", createPluginSchema),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // 检查权限：只有作者可以更新
    const { data: existing, error: fetchError } = await supabase
      .from("plugins")
      .select("author_id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return c.json(
        { success: false, error: { message: "Plugin not found" } },
        404
      );
    }

    if (existing.author_id !== profile.id) {
      return c.json(
        { success: false, error: { message: "Unauthorized" } },
        403
      );
    }

    const { data: plugin, error: updateError } = await supabase
      .from("plugins")
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    return c.json({
      success: true,
      message: "插件更新成功",
      data: { plugin },
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /plugins/:id 删除插件
app.delete(
  "/plugins/:id",
  authMiddleware,
  profileMiddleware,
  zValidator("param", pluginParamsSchema),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const { id } = c.req.valid("param");

    // 检查权限：只有作者可以删除
    const { data: existing, error: fetchError } = await supabase
      .from("plugins")
      .select("author_id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return c.json(
        { success: false, error: { message: "Plugin not found" } },
        404
      );
    }

    if (existing.author_id !== profile.id) {
      return c.json(
        { success: false, error: { message: "Unauthorized" } },
        403
      );
    }

    const { error: deleteError } = await supabase
      .from("plugins")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return c.json({
      success: true,
      message: "插件删除成功",
      timestamp: new Date().toISOString(),
    });
  }
);

Deno.serve(app.fetch);
