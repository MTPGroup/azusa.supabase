import { Database } from "../_shared/database.types.ts";
import {
  createApp,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = createApp();

const updateSettingsSchema = z.object({
  theme: z.string().optional(),
  chatModels: z.any().optional(),
});

// GET /settings 获取用户设置
app.get("/settings", authMiddleware, profileMiddleware, async (c) => {
  const supabase = c.get("supabase");
  const profile = c.get("profile");

  const { data: settings, error } = await supabase
    .from("settings")
    .select("*")
    .eq("owner_id", profile.id)
    .single();

  if (error) {
    return c.json(
      {
        success: false,
        error: { message: error.message, code: error.code },
        timestamp: new Date().toISOString(),
      },
      400
    );
  }

  return c.json({
    success: true,
    message: "成功获取用户设置",
    data: {
      ownerId: settings.owner_id,
      theme: settings.theme,
      chatModels: settings.chat_models,
      createdAt: settings.created_at,
      updatedAt: settings.updated_at,
    },
  });
});

// PATCH /settings 更新用户设置
app.patch(
  "/settings",
  authMiddleware,
  profileMiddleware,
  zValidator("json", updateSettingsSchema, (result, c) => {
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
    const updates: Partial<Database["public"]["Tables"]["settings"]["Row"]> =
      {};
    if (body.theme) updates.theme = body.theme;
    if (body.chatModels) updates.chat_models = body.chatModels;

    const { data: settings, error } = await supabase
      .from("settings")
      .update(updates)
      .eq("owner_id", profile.id)
      .select()
      .single();

    if (error) {
      return c.json(
        {
          success: false,
          error: { message: error.message, code: error.code },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }

    return c.json({
      success: true,
      message: "成功更新用户设置",
      data: {
        theme: settings.theme,
        chatModels: settings.chat_models,
      },
    });
  }
);

Deno.serve(app.fetch);
