import {
  createApp,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = createApp();

const contactParamsSchema = z.object({
  characterId: z.string().uuid(),
});

const updateContactSchema = z.object({
  nickname: z.string().optional(),
});

// GET /contacts 获取联系人列表
app.get("/contacts", authMiddleware, profileMiddleware, async (c) => {
  const supabase = c.get("supabase");
  const profile = c.get("profile");

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select(
      `
      *,
      character:characters!contacts_contact_id_fkey (
        *,
        author:profiles!characters_author_id_fkey(*)
      )
    `
    )
    .eq("profile_id", profile.id);

  if (error) throw error;

  return c.json({
    success: true,
    message: "成功获取联系人列表",
    data: {
      contacts: contacts.map((item) => {
        const char = item.character;
        return {
          id: char.id,
          name: char.name,
          nickname: item.nickname,
          avatarUrl: char.avatar,
          bio: char.bio,
          originPrompt: char.origin_prompt,
          isPublic: char.is_public,
          creatorId: char.author.uid,
          createdAt: char.created_at,
          updatedAt: char.updated_at,
          author: {
            id: char.author.uid,
            name: char.author.username,
            avatar: char.author.avatar,
          },
        };
      }),
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /contacts/:characterId 添加联系人
app.post(
  "/contacts/:characterId",
  authMiddleware,
  profileMiddleware,
  zValidator("param", contactParamsSchema, (result, c) => {
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
    const { characterId } = c.req.valid("param");

    // 检查联系人是否已存在
    const { data: existing } = await supabase
      .from("contacts")
      .select("contact_id")
      .eq("profile_id", profile.id)
      .eq("contact_id", characterId)
      .single();

    if (existing) {
      return c.json(
        { success: false, error: { message: "Contact already exists" } },
        409
      );
    }

    const { error } = await supabase
      .from("contacts")
      .insert({
        profile_id: profile.id,
        contact_id: characterId,
      })
      .select()
      .single();

    if (error) throw error;

    return c.json(
      {
        success: true,
        message: "联系人添加成功",
        data: {
          message: "联系人添加成功",
          contactId: characterId,
        },
        timestamp: new Date().toISOString(),
      },
      201
    );
  }
);

// PUT /contacts/:characterId 更新联系人
app.put(
  "/contacts/:characterId",
  authMiddleware,
  profileMiddleware,
  zValidator("param", contactParamsSchema, (result, c) => {
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
  zValidator("json", updateContactSchema, (result, c) => {
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
    const { characterId } = c.req.valid("param");
    const { nickname } = c.req.valid("json");

    const { error } = await supabase
      .from("contacts")
      .update({ nickname })
      .eq("profile_id", profile.id)
      .eq("contact_id", characterId);

    if (error) throw error;

    return c.json({
      success: true,
      message: "联系人更新成功",
      data: {
        message: "联系人更新成功",
        contactId: characterId,
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /contacts/:characterId 删除联系人
app.delete(
  "/contacts/:characterId",
  authMiddleware,
  profileMiddleware,
  zValidator("param", contactParamsSchema, (result, c) => {
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
    const { characterId } = c.req.valid("param");

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("profile_id", profile.id)
      .eq("contact_id", characterId);

    if (error) throw error;

    return c.json({
      success: true,
      message: "联系人删除成功",
      data: {
        message: "联系人删除成功",
      },
      timestamp: new Date().toISOString(),
    });
  }
);

Deno.serve(app.fetch);
