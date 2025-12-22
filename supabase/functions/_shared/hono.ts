import { Hono, Context, Next } from "hono";
import { cors } from "hono/cors";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { type Database } from "./database.types.ts";

export type Variables = {
  supabase: SupabaseClient<Database>;
  user: User;
  profile: Database["public"]["Tables"]["profiles"]["Row"];
};

export const createApp = () => {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", cors());
  app.use("*", async (c, next) => {
    console.log(`[${c.req.method}] ${c.req.path}`);
    await next();
  });

  app.onError((err, c) => {
    console.error("Internal Server Error:", err);
    return c.json(
      {
        success: false,
        error: {
          message: err.message || "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
          details: err.stack,
        },
        timestamp: new Date().toISOString(),
      },
      500
    );
  });

  return app;
};

export const getSupabaseClient = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  const options = authHeader
    ? { global: { headers: { Authorization: authHeader } } }
    : {};
  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ??
      Deno.env.get("LOCAL_DEV_SUPABASE_URL") ??
      "",
    Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("LOCAL_DEV_SUPABASE_ANON_KEY") ??
      "",
    options
  );
};

export const authMiddleware = async (
  c: Context<{ Variables: Variables }>,
  next: Next
) => {
  const supabase = getSupabaseClient(c.req.raw);
  c.set("supabase", supabase);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return c.json(
      {
        success: false,
        error: {
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        },
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  c.set("user", user);
  await next();
};

export const profileMiddleware = async (
  c: Context<{ Variables: Variables }>,
  next: Next
) => {
  const user = c.get("user");
  const supabase = c.get("supabase");

  if (!user) {
    return c.json(
      {
        success: false,
        error: {
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        },
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("uid", user.id)
    .single();

  if (error || !profile) {
    return c.json(
      {
        success: false,
        error: {
          message: "Profile not found",
          code: "PROFILE_NOT_FOUND",
        },
        timestamp: new Date().toISOString(),
      },
      404
    );
  }

  c.set("profile", profile);
  await next();
};
