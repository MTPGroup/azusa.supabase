import { createClient } from "@supabase/supabase-js";
import { load } from "@std/dotenv";

await load({ export: true });

/**
 * 环境配置：
 * - docker: 使用 docker-compose (端口 8000, ANON_KEY)
 * - cli: 使用 supabase-cli (端口 54321, SUPABASE_PUBLISHABLE_KEY)
 *
 * 通过 TEST_ENV 环境变量切换，默认为 cli
 * 使用方式: TEST_ENV=docker deno test --allow-all
 */
const testEnv = Deno.env.get("TEST_ENV") ?? "cli";

const config = {
  docker: {
    url: Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000",
    key: Deno.env.get("ANON_KEY") ?? "",
  },
  cli: {
    url: Deno.env.get("SUPABASE_CLI_URL") ?? "http://127.0.0.1:54321",
    key: Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
  },
};

const envConfig = config[testEnv as keyof typeof config] ?? config.docker;

console.log(`[Test] Using ${testEnv} environment: ${envConfig.url}`);

export const supabase = createClient(envConfig.url, envConfig.key);

const email = "test@example.com";
const password = "123456";

await supabase.auth.signInWithPassword({
  email,
  password,
});
