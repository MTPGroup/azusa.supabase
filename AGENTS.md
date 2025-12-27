# Repository Guidelines

## Project Structure & Module Organization

This repository hosts a Supabase-backed API built with Deno edge functions. Key paths:

- `supabase/functions/`: Edge Functions organized by feature (`profiles`, `settings`, `characters`, `knowledge`, etc.), with shared helpers in `_shared`.
- `supabase/migrations/`: Database schema migrations.
- `supabase/tests/`: Deno integration tests for API behavior.
- `utils/`: Scripts such as type generation.
- `docker-compose.yml`: Local development stack.
- `volumes/`: Docker persistent data (do not hand-edit).

## Build, Test, and Development Commands

Common commands (run from the repo root):

- `docker-compose up -d`: Start the local Supabase stack and services.
- `docker-compose logs -f functions`: Tail edge function logs.
- `docker-compose restart functions`: Restart edge functions after changes.
- `deno task gen:types`: Generate TypeScript types (writes to project files).
- `deno task test:api`: Run API tests via Deno.
- `TEST_ENV=docker deno test --allow-all`: Run tests against Docker (as documented).

## Coding Style & Naming Conventions

- Language: TypeScript running on Deno (edge functions).
- Formatting: prefer `deno fmt` for consistent formatting.
- Organization: place new endpoints in `supabase/functions/<feature>/` and shared utilities in `supabase/functions/_shared/`.
- Naming: keep feature folders in kebab-case and keep API modules feature-scoped.

## Testing Guidelines

- Tests live in `supabase/tests/` and use Deno’s built-in test runner.
- Keep test names descriptive and behavior-focused.
- Use `TEST_ENV=docker` or `TEST_ENV=cli` when targeting different runtimes.

## Commit & Pull Request Guidelines

- Commit messages follow a lightweight Conventional Commits style, often prefixed with an emoji, e.g. `✨ ...` or `📝 ...`.
- Prefer concise中文描述，格式：`<emoji> <简短中文概要>`;
- 主题行尽量一句话说清“做了什么/为什么”，避免冗长或空洞词（如“update”、“fix”无上下文）。
- PRs should include: a short summary, testing notes (commands run), and any relevant configuration changes.
- Link related issues when available and include screenshots only when changing observable UI or API responses.

## Security & Configuration Notes

- Copy `.env.example` to `.env` before running locally.
- Row Level Security (RLS) is enabled; ensure new tables and policies follow existing patterns.

## Migration Create Guidelines

- Please use supabase-cli to create migration files to ensure that the migration files format is consistent.
- command: `supabase migration new <migration_name>`

## Supabase MCP Local Usage

Use the built-in `supabase-mcp-local` tools for local Supabase insight and migrations.

- Prereq: bring up the stack (`docker-compose up -d`) so the MCP endpoints can read metadata.
- Read-only inspection: `supabase-mcp-local_list_tables`, `supabase-mcp-local_list_extensions`, `supabase-mcp-local_get_logs` (per service), `supabase-mcp-local_get_project_url`, `supabase-mcp-local_get_publishable_keys`.
- Docs/search: `supabase-mcp-local_search_docs` (GraphQL query), `supabase-mcp-local_generate_typescript_types`.
- Database changes: prefer `supabase-mcp-local_apply_migration` for DDL; keep names snake_case; avoid hardcoding generated IDs in data migrations. For ad-hoc queries use `supabase-mcp-local_execute_sql` (read/write; be careful).
- Advisory and safety: use `supabase-mcp-local_get_advisors` (security/performance) after schema changes.
- Verification: run Deno tests or relevant checks after applying migrations; do not rely solely on MCP responses.
