# Repository Guidelines

10xCards — an Astro 6 SSR web app with React 19 islands, Supabase auth/database, Tailwind 4, and Cloudflare Workers deployment. AI-powered flashcard generation with spaced repetition.

## Hard Rules

- Never add `"use client"` or other Next.js directives — this is Astro, not Next.
- Never concatenate Tailwind classes manually; always use the `cn()` helper from `@/lib/utils`.
- Every new Supabase table must enable RLS immediately with granular per-operation, per-role policies.
- Environment secrets (`SUPABASE_URL`, `SUPABASE_KEY`) are server-only; access them via `astro:env/server`, never expose to client bundles.
- Do not retain user source text after AI generation completes — no persistence of submitted content.

## Project Structure

- `src/pages/` — Astro pages and `api/` route handlers (SSR, `output: "server"`)
- `src/components/` — Astro components for static content; React (`.tsx`) only when interactivity is required
- `src/components/ui/` — shadcn/ui components ("new-york" style); add new ones via `npx shadcn@latest add <name>`
- `src/lib/` — helpers, Supabase client, services; business logic extracts to `src/lib/services/`
- `src/types.ts` — shared entity types and DTOs
- `supabase/migrations/` — SQL migrations named `YYYYMMDDHHmmss_short_description.sql`
- Deeper context: @context/foundation/prd.md, @context/foundation/tech-stack.md

## Build, Test, and Development

- See @package.json scripts
- Pre-commit hook (husky + lint-staged) auto-runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Coding Conventions

- Path alias: `@/*` → `./src/*`; always use it instead of relative `../` paths.
- API route handlers export uppercase HTTP methods (`GET`, `POST`); validate input with Zod.
- React hooks extract to `src/components/hooks/`.

## CI Gate

GitHub Actions on push/PR to `master`: `npm run lint` → `npm run build`. Both must pass. See @.github/workflows/ci.yml.

## Security & Environment

- Local secrets: copy `.env.example` to `.dev.vars` (gitignored) for Cloudflare local dev.
- Supabase local: `npx supabase start` (requires Docker).
- Deploy: `npx wrangler deploy` (Cloudflare account + auth required).
- Node.js v22.14.0 (see .nvmrc)

## Lessons learned

See: `context/foundation/lessons.md`