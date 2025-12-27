import { load } from "@std/dotenv";

// 加载环境变量
await load({ export: true, envPath: ".env" });

const password = Deno.env.get("POSTGRES_PASSWORD");
if (!password) {
  console.error("Error: POSTGRES_PASSWORD not found in .env file");
  Deno.exit(1);
}

// Docker Compose 中 db 服务映射到宿主机的端口 (查看 docker-compose.yml)
// 默认为 5433 (5433:5432)
const port = "5433";
const host = "localhost";
const user = "postgres";
const db = "postgres";

const dbUrl = `postgresql://${user}:${password}@${host}:${port}/${db}`;

console.log(`Generating types from ${dbUrl}...`);

const command = new Deno.Command("supabase", {
  args: ["gen", "types", "typescript", "--db-url", dbUrl],
  stdout: "piped",
  stderr: "piped",
});

const { code, stdout, stderr } = await command.output();

if (code === 0) {
  const types = new TextDecoder().decode(stdout);
  await Deno.writeTextFile(
    "supabase/functions/_shared/database.types.ts",
    types,
  );
  console.log(
    "✅ Types generated successfully at supabase/functions/_shared/database.types.ts",
  );
  await Deno.writeTextFile(
    "supabase/workers/database.types.ts",
    types,
  );
  console.log(
    "✅ Types generated successfully at supabase/workers/database.types.ts",
  );
} else {
  console.error("❌ Error generating types:");
  console.error(new TextDecoder().decode(stderr));
  Deno.exit(code);
}
