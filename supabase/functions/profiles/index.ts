import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createApp,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";

const app = createApp();

const updateProfileSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  avatar: z.string().optional().nullable(),
});

app.get("/profiles", authMiddleware, profileMiddleware, (c) => {
  const profile = c.get("profile");

  return c.json({
    success: true,
    message: "成功获取用户信息",
    data: profile,
  });
});

app.put(
  "/profiles",
  authMiddleware,
  zValidator("json", updateProfileSchema, (result, c) => {
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
    const user = c.get("user");
    const validatedData = c.req.valid("json");

    const { data: profile, error } = await supabase
      .from("profiles")
      .update(validatedData)
      .eq("uid", user.id)
      .select()
      .single();

    if (error) {
      return c.json(
        {
          success: false,
          error: {
            message: error.message,
            code: error.code,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }

    return c.json({
      success: true,
      message: "成功更新用户信息",
      data: profile,
    });
  }
);

Deno.serve(app.fetch);
