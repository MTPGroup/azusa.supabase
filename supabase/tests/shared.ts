import { createClient } from "@supabase/supabase-js";
import { load } from "@std/dotenv";

await load({ export: true });

export const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? ""
);

const email = "test@example.com";
const password = "123456";

await supabase.auth.signInWithPassword({
  email,
  password,
});
