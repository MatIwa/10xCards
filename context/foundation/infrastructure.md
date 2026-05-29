---
project: 10xCards
researched_at: 2026-05-29
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR) + React 19 islands
  runtime: Cloudflare Workers (V8 isolates)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

Cloudflare is the only platform that scored Pass on all five agent-friendly criteria — CLI-first ops via `wrangler`, fully managed serverless runtime, agent-readable docs (llms.txt + GitHub markdown), deterministic deploy API, and a mature MCP ecosystem. It is also the platform the project is already configured for: `@astrojs/cloudflare@^13.5.0` adapter, `wrangler.jsonc`, and `nodejs_compat` flag are in place — zero migration friction. The free tier (100k requests/day, $0/mo) covers MVP traffic with massive headroom. Interview answers (no persistent connections, single region, no strong platform preference) align naturally with Workers' serverless model.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **5/5** |
| **Vercel** | ✅ Pass | ✅ Pass | ⚠️ Partial | ✅ Pass | ✅ Pass | **4/5** |
| **Railway** | ✅ Pass | ✅ Pass | ⚠️ Partial | ✅ Pass | ✅ Pass | **4/5** |
| **Fly.io** | ✅ Pass | ⚠️ Partial | ✅ Pass | ✅ Pass | ✅ Pass | **4/5** |
| **Netlify** | ⚠️ Partial | ✅ Pass | ✅ Pass | ⚠️ Partial | ✅ Pass | **3/5** |
| **Render** | ⚠️ Partial | ✅ Pass | ⚠️ Partial | ✅ Pass | ✅ Pass | **3/5** |

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Perfect 5/5 score. The project already runs the `@astrojs/cloudflare` adapter with `wrangler.jsonc` configured — deploying is a single `npx wrangler deploy`. The free tier covers 100k requests/day (≈3M/mo), far exceeding MVP needs. `wrangler` provides deploy, rollback, log tailing, and local dev (`wrangler dev`). Cloudflare publishes `llms.txt` for all products and maintains official MCP servers with structured tools for observability, builds, and docs. Cold starts are negligible (<5ms, isolate-based). All core features (Workers, Pages, D1, R2, KV, Queues, Durable Objects, Hyperdrive) are GA as of May 2026.

#### 2. Vercel

Strong DX with 4/5 score. Astro SSR is supported via `@astrojs/vercel/serverless` (GA). The CLI is comprehensive (`vercel deploy --prod`, `vercel rollback`, `vercel logs --follow`), and the `vercel mcp` command provides GA-level agent integration. The gap vs. Cloudflare: docs are JS-rendered SPA without llms.txt or raw GitHub markdown — agents cannot fetch and parse them directly. Adopting Vercel would require swapping the adapter from `@astrojs/cloudflare` to `@astrojs/vercel`. Hobby tier is free (1M function invocations/mo). Cold starts can add ≥1s after function archival (2 weeks prod / 48h preview).

#### 3. Railway

4/5 score with the strongest agent-integration story of any PaaS: MCP server (local + remote), `railway agent` CLI chat, and `railway skills install`. Node.js auto-detected via Railpack, WebSockets fully supported. The gap: docs are GitHub markdown but lack llms.txt, and the platform costs $5/mo minimum on Hobby (no meaningful free tier post-trial). Adopting Railway requires swapping to `@astrojs/node` in standalone mode and configuring `server.host = "0.0.0.0"`. Co-located Postgres/Redis available as unmanaged containers, though Supabase remains the external DB.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Node.js API compatibility gaps.** The Workers runtime is V8 isolate-based, not Node.js. Even with `nodejs_compat`, packages using unsupported `node:*` APIs (e.g., `node:child_process`, `node:fs` writes, some `node:crypto` methods) will fail at build or crash at runtime. Every new dependency must be audited for Workers compatibility.
2. **128 MB memory ceiling per isolate — no override.** If the AI generation feature buffers large LLM responses or processes large user-submitted text in-memory, the isolate can OOM. Unlike Vercel (2 GB Hobby) or Railway (scalable), there is no higher-memory tier.
3. **Supabase round-trip latency from edge.** Workers run at the nearest edge PoP, but Supabase is in a single region. Every SSR request querying Supabase adds a cross-region network hop. Hyperdrive helps connection pooling but doesn't eliminate geography.
4. **Debugging experience is rougher.** `wrangler dev` emulates the Workers runtime locally but it's not Node.js — stack traces can be cryptic, breakpoints behave differently, and some npm packages that work in local Node.js testing fail once deployed.
5. **Vendor-specific API surface.** Code using Cloudflare bindings (`env.SUPABASE_URL` via Astro env schema) is not portable. Migrating away requires non-trivial refactoring of every handler that touches a binding.

### Pre-Mortem — How This Could Fail

The team shipped 10xCards to Cloudflare Workers confidently — free tier, edge speed, agent-friendly CLI. Six months later, it was a disaster. The AI generation endpoint started timing out: LLM API calls took 15+ seconds, and while Workers supports streaming, the 128 MB memory ceiling caused sporadic OOM crashes with no useful error messages when batching multiple card-generation requests. The team added a dependency for PDF parsing (a natural user request for file upload) that silently broke on Workers due to a `node:fs` import buried three levels deep — discovered only after deploy, in production, with no local reproduction path. Supabase latency became the dominant bottleneck: every SSR page load made 2-3 Supabase queries, each adding 80-120ms of cross-region hop. Users near the Supabase region got acceptable performance; everyone else saw 400ms+ TTFB. Debugging production issues required `wrangler tail` and JSON log parsing — no APM, no distributed traces, no memory profiling. When they finally decided to migrate to a Node.js platform, every Cloudflare-specific environment access pattern had to be rewritten, and the adapter swap broke half the Astro middleware chain.

### Unknown Unknowns

- **Workers CPU time limits are per-request, not per-second.** Free tier allows 10ms CPU time per request; paid allows 30ms. This is CPU execution time, not wall-clock time — waiting on `fetch()` to Supabase doesn't count. But heavy JSON parsing or Zod validation of large payloads can hit the ceiling, causing silent 1027 errors that look like random 500s.
- **`wrangler.jsonc` and `wrangler.toml` are both valid config formats, but tooling support differs.** Some community tools and tutorials assume `.toml`; the project uses `.jsonc`. Copying configuration snippets from docs may silently fail if format differences aren't noticed.
- **Cloudflare Pages + Workers function routing has subtle path-matching rules.** SSR routes go through `_worker.js`, and static assets take priority. If a static file and a dynamic route share a path segment, the static file wins silently — no error, just wrong content.
- **Auto Minify in the Cloudflare dashboard (enabled by default on some accounts) can break React hydration.** The minifier strips whitespace that React's hydration algorithm relies on for text node matching. The fix is to disable it, but nothing warns you it's on.
- **Cloudflare's support tier for free/Pro plans is community forums only.** If a Workers runtime bug blocks your deploy, there's no escalation path faster than posting on the community forum.

## Operational Story

- **Preview deploys**: `npx wrangler versions upload` creates a preview version. For PR-based previews, configure GitHub Actions to deploy a versioned Worker per branch. Preview URLs are not password-protected by default — add Cloudflare Access (free for up to 50 users) if the app handles sensitive data before launch.
- **Secrets**: Environment variables set via `npx wrangler secret put <NAME>` or in the Cloudflare dashboard under Workers > Settings > Variables. Secrets are encrypted at rest, not readable via CLI after creation (write-only). For local dev, store them in `.dev.vars` (gitignored). Rotation: `wrangler secret put <NAME>` overwrites the existing value; no versioning.
- **Rollback**: `npx wrangler rollback` reverts to the previous deployment version. Typical time-to-revert: <30 seconds. Caveat: rollback is code-only — database migrations (Supabase) do not roll back automatically. Always verify DB compatibility before rolling back.
- **Approval**: Human-only actions: publish a new production version (or configure auto-deploy via CI), rotate Supabase service role keys, modify DNS records, change Cloudflare account billing. Agent-safe actions: `wrangler deploy`, `wrangler tail`, `wrangler secret put`, `wrangler dev`.
- **Logs**: `npx wrangler tail` streams real-time logs from the deployed Worker (JSON format, filterable by status/method/path). For persistent logs, enable `observability.enabled: true` in `wrangler.jsonc` (already configured in this project) — logs retained for 7 days on paid plan, queryable via dashboard or Workers Logs API.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| npm dependency uses unsupported Node.js API, breaks at deploy | Devil's advocate | M | H | Run `npx wrangler deploy --dry-run --outdir bundled/` before adding any new dependency. Audit transitive deps with `npm ls`. |
| 128 MB memory OOM on AI generation endpoint | Devil's advocate | L | H | Stream LLM responses instead of buffering. Set response size limits in Zod validation. Monitor with `wrangler tail` for memory errors. |
| Supabase cross-region latency degrades TTFB | Devil's advocate | M | M | Enable Hyperdrive for connection pooling. Consider Smart Placement (routes Worker to region nearest DB). Keep Supabase region aligned with primary user geography. |
| New dependency silently fails in production (no local repro) | Pre-mortem | M | H | Always test with `wrangler dev` (not `astro dev` alone) before deploying. Add a smoke-test step in CI that builds with `wrangler`. |
| CPU time limit exceeded on heavy Zod validation | Unknown unknowns | L | M | Profile CPU-heavy endpoints with `wrangler tail --format json`. Break large validation into chunks. Upgrade to paid plan ($5/mo) for 30ms CPU ceiling if needed. |
| Auto Minify breaks React hydration | Unknown unknowns | L | H | Disable Auto Minify in Cloudflare dashboard immediately after first deploy. Add to deploy checklist. |
| Static asset shadows dynamic route silently | Unknown unknowns | L | M | Avoid placing files in `public/` with paths that overlap dynamic Astro routes. Test all routes after deploy. |
| Community-only support on free/Pro plans | Research finding | L | L | Maintain fallback plan: adapter swap to `@astrojs/node` + Vercel/Railway if blocked by a runtime bug for >48h. |

## Getting Started

1. **Authenticate with Cloudflare**: `npx wrangler login` — opens browser for OAuth. Verify with `npx wrangler whoami`.
2. **Set secrets for Supabase**: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` — paste values when prompted. For local dev, these live in `.dev.vars` (already gitignored).
3. **Build and deploy**: `npm run build && npx wrangler deploy` — the project's `wrangler.jsonc` is already configured with the correct entrypoint (`@astrojs/cloudflare/entrypoints/server`), `nodejs_compat` flag, and `dist` asset directory.
4. **Verify deployment**: `npx wrangler tail` to confirm requests are hitting the Worker. Visit the URL printed by `wrangler deploy` to smoke-test the app.
5. **Disable Auto Minify**: In Cloudflare dashboard → Speed → Optimization → Content Optimization → disable Auto Minify (JS, CSS, HTML) to prevent React hydration breakage.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
