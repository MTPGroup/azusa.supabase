import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  authMiddleware,
  createApp,
  profileMiddleware,
} from "../_shared/hono.ts";

const app = createApp();

const makeSafeStorageFileName = (fileName: string): string => {
  const trimmed = fileName.trim();
  const replacedSpaces = trimmed.replace(/\s+/g, "_");
  const cleaned = replacedSpaces.replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned.length > 0 ? cleaned : "avatar";
};

const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

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
        400,
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
        400,
      );
    }

    return c.json({
      success: true,
      message: "成功更新用户信息",
      data: profile,
    });
  },
);

app.post(
  "/profiles/avatar",
  authMiddleware,
  async (c) => {
    const supabase = c.get("supabase");
    const user = c.get("user");

    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json(
        {
          success: false,
          error: {
            message: "Content-Type must be multipart/form-data",
            code: "INVALID_CONTENT_TYPE",
          },
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    const body = await c.req.parseBody();
    const file = body["file"] ?? body["avatar"];

    if (!(file instanceof File)) {
      return c.json(
        {
          success: false,
          error: {
            message: "Avatar file is required",
            code: "FILE_REQUIRED",
          },
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    if (file.size > MAX_AVATAR_SIZE) {
      return c.json(
        {
          success: false,
          error: {
            message: "Avatar file is too large",
            code: "FILE_TOO_LARGE",
          },
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    if (!file.type || !ALLOWED_AVATAR_TYPES.has(file.type)) {
      return c.json(
        {
          success: false,
          error: {
            message: "Avatar file type is not allowed",
            code: "INVALID_FILE_TYPE",
          },
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    const safeFileName = makeSafeStorageFileName(file.name || "avatar.png");
    const storagePath = `${user.id}/${Date.now()}_${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return c.json(
        {
          success: false,
          error: {
            message: "Failed to upload avatar",
            code: uploadError.message,
          },
          timestamp: new Date().toISOString(),
        },
        500,
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(storagePath);

    if (!publicUrlData?.publicUrl) {
      return c.json(
        {
          success: false,
          error: {
            message: "Failed to generate avatar URL",
            code: "URL_GENERATION_FAILED",
          },
          timestamp: new Date().toISOString(),
        },
        500,
      );
    }

    const avatarUrl = publicUrlData.publicUrl;

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar: avatarUrl })
      .eq("uid", user.id)
      .select()
      .single();

    if (updateError) {
      return c.json(
        {
          success: false,
          error: {
            message: updateError.message,
            code: updateError.code,
          },
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    return c.json({
      success: true,
      message: "头像上传成功",
      data: {
        avatarUrl,
        profile,
      },
    });
  },
);

Deno.serve(app.fetch);
