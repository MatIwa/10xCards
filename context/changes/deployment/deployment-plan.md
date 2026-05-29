# Plan: Cloudflare Workers Deployment

Deploy 10xCards (Astro 6 SSR + React 19) to Cloudflare Workers using the already-configured `@astrojs/cloudflare` adapter and `wrangler.jsonc`. The project is ~90% ready — remaining work covers local dev env, secrets, first deploy, CI/CD extension, and post-deploy hardening.

---

## Phase 0: Prerequisites

### 0A — Node.js & Project Dependencies

- [ ] **0A.1** Install Node.js v22.14.0 (see `.nvmrc`). Recommended: use `nvm` (Linux/macOS) or `nvm-windows`
- [ ] **0A.2** Run `npm ci` to install all dependencies (includes `wrangler@^4.90.0` as a devDependency)
- [ ] **0A.3** Verify wrangler is available: `npx wrangler --version` (should print 4.90+)

### 0B — Cloudflare CLI (`wrangler`) Setup

- [ ] **0B.1** Wrangler is already a devDependency — no global install needed. All commands use `npx wrangler`
- [ ] **0B.2** Authenticate: `npx wrangler login` — opens browser for Cloudflare OAuth
- [ ] **0B.3** Verify authentication: `npx wrangler whoami` — should show account name and ID
- [ ] **0B.4** Note your **Account ID** from the output (needed for CI/CD in Phase 4)

**Edge case support:**
- If OAuth redirect fails (corporate firewall, WSL, headless server): create an API Token manually at https://dash.cloudflare.com/profile/api-tokens with permissions: `Workers Scripts:Edit`, `Account Settings:Read`. Then set env var: `$env:CLOUDFLARE_API_TOKEN = "<token>"` (PowerShell) or `export CLOUDFLARE_API_TOKEN=<token>` (bash)
- If `npx wrangler` fails with EACCES/permissions errors on Windows: delete `node_modules/.cache` and re-run `npm ci`
- Multiple Cloudflare accounts? Use `npx wrangler login` and select the correct account, or set `CLOUDFLARE_ACCOUNT_ID` explicitly

### 0C — Supabase Setup

#### Remote (production) Supabase project:

- [ ] **0C.1** Create a Supabase project at https://supabase.com/dashboard (or use existing)
- [ ] **0C.2** From Project Settings → API, copy:
  - **Project URL** → this is your `SUPABASE_URL` (format: `https://<project-ref>.supabase.co`)
  - **`anon` public key** → this is your `SUPABASE_KEY` (the anon/public key, NOT the service role key)
- [ ] **0C.3** Ensure the project has Auth enabled (enabled by default on new projects)
- [ ] **0C.4** In Auth → URL Configuration, add your Workers URL to **Redirect URLs**:
  - `https://10xcards.<account>.workers.dev/**` (wildcard for all paths)
  - `http://localhost:4321/**` (for local dev)
  - `http://localhost:8787/**` (for `wrangler dev`)

#### Local Supabase (optional, for offline development):

- [ ] **0C.5** Install Docker Desktop (required for local Supabase)
- [ ] **0C.6** Start local Supabase: `npx supabase start` — prints local credentials on first run
- [ ] **0C.7** Local URLs (from `supabase start` output):
  - API URL: `http://127.0.0.1:54321`
  - `anon` key: printed in terminal output
- [ ] **0C.8** Use these local values in `.dev.vars` for development against local Supabase

**Edge case support:**
- Docker not available? Skip local Supabase — use the remote project URL in `.dev.vars` instead (works fine for dev, just slower)
- `supabase start` hangs → check Docker daemon is running: `docker info`
- Port conflicts (54321/54322 already in use) → edit ports in `supabase/config.toml`
- If you see "Invalid API key" errors → you're using the wrong key. Use the **anon** key (starts with `eyJ...`), not the service role key
- Supabase project pauses after 7 days inactivity on free tier — wake it from the dashboard before deploying

### 0D — Verify Project Builds

- [ ] **0D.1** Run `npx astro sync` (generates type definitions)
- [ ] **0D.2** Run `npm run build` — should complete without errors
- [ ] **0D.3** Run `npm run lint` — should pass (CI gate requirement)

**Edge case support:**
- Build fails with "missing env vars" → Astro env schema marks them `optional: true`, so build should succeed. If not, create `.dev.vars` first (Phase 1.1)
- TypeScript errors in `.astro` files → run `npx astro sync` to regenerate types

---

## Phase 1: Local Development Environment

- [ ] **1.1** Create `.dev.vars` with `SUPABASE_URL` and `SUPABASE_KEY` values
- [ ] **1.2** Enable `platformProxy: { enabled: true }` in the `cloudflare()` adapter call in `astro.config.mjs` — makes `astro dev` emulate Workers runtime
- [ ] **1.3** Verify with `wrangler dev` (actual Workers V8 isolate locally)
- [ ] **1.4** Dry-run build: `npx wrangler deploy --dry-run --outdir bundled/` — catches `node:*` API incompatibilities early

**Edge case support:**
- If `wrangler dev` errors on `node:*` APIs → audit transitive deps via `npm ls`; the offending package won't work on Workers
- `.dev.vars` is already in the gitignore pattern — verify before committing

---

## Phase 2: Cloudflare Account & Secrets

- [ ] **2.1** `npx wrangler login` → verify with `npx wrangler whoami`
- [ ] **2.2** Set secrets: `npx wrangler secret put SUPABASE_URL` / `npx wrangler secret put SUPABASE_KEY`
- [ ] **2.3** Rename Worker from `10x-astro-starter` → `10xcards` in `wrangler.jsonc` `"name"` field (harder to rename post-deploy)
- [ ] **2.4** Verify: `npx wrangler secret list`

**Edge case support:**
- Behind corporate proxy/VPN? Use `CLOUDFLARE_API_TOKEN` env var instead of OAuth login
- Secrets are write-only after creation — keep secure record of values externally
- "Could not route to /accounts/..." → API token missing correct account permissions

---

## Phase 3: First Production Deploy

- [ ] **3.1** `npm run build`
- [ ] **3.2** `npx wrangler deploy`
- [ ] **3.3** Note deployment URL (`https://10xcards.<account>.workers.dev`)
- [ ] **3.4** Smoke-test:
  - `/` loads home page
  - `/auth/signin` and `/auth/signup` render forms
  - `POST /api/auth/signin` returns redirect (not 500)
  - `/dashboard` redirects to `/auth/signin` when unauthenticated
- [ ] **3.5** `npx wrangler tail` — confirm no runtime errors

**Edge case support:**
- "workers.dev subdomain not provisioned" → `npx wrangler subdomain <name>`
- "Cannot find module..." in prod but not locally → `node:*` API issue, check bundled output from 1.4
- Supabase connection fails → verify Supabase project isn't IP-restricted

---

## Phase 4: CI/CD — Automated Deployment

- [ ] **4.1** Create scoped Cloudflare API Token: `Workers Scripts:Edit` + `Account:Read`
- [ ] **4.2** Add GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- [ ] **4.3** Extend `.github/workflows/ci.yml` with a `deploy` job:
  - Triggers only on push to `master` (not PRs)
  - Depends on `ci` job passing
  - Runs `npm run build && npx wrangler deploy`
  - Uses `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as env vars
- [ ] **4.4** *(Optional)* Add PR preview deploys via `wrangler versions upload`

**Edge case support:**
- Never use the Global API Key — always scoped tokens
- If deploy succeeds but Worker doesn't update → `CLOUDFLARE_ACCOUNT_ID` mismatch
- Build step still needs `SUPABASE_URL`/`SUPABASE_KEY` for Astro type generation (already in GitHub secrets)

---

## Phase 5: Post-Deploy Hardening

- [ ] **5.1** Disable Auto Minify: Cloudflare dashboard → Speed → Optimization → Content Optimization → OFF for JS/CSS/HTML (prevents React hydration breakage)
- [ ] **5.2** Verify no `public/` files shadow dynamic routes in `src/pages/`
- [ ] **5.3** Add `bundled/` to `.gitignore`
- [ ] **5.4** *(Optional)* Enable Cloudflare Access (free, ≤50 users) for pre-launch protection
- [ ] **5.5** Document rollback: `npx wrangler rollback` (code-only; Supabase migrations do NOT rollback)
- [ ] **5.6** Add npm script: `"deploy": "npm run build && wrangler deploy"` to `package.json`

**Edge case support:**
- Auto Minify can be silently re-enabled during plan changes — add to recurring deploy checklist
- React hydration errors in prod but not locally? Auto Minify is suspect #1
- Custom domain: Workers → Custom Domains → Add (requires DNS zone on Cloudflare)

---

## Relevant Files

| File | Action |
|------|--------|
| `astro.config.mjs` | Add `platformProxy: { enabled: true }` to `cloudflare()` |
| `wrangler.jsonc` | Rename `"name"` from `10x-astro-starter` → `10xcards` |
| `.dev.vars` | Create (SUPABASE_URL, SUPABASE_KEY) |
| `.github/workflows/ci.yml` | Add `deploy` job |
| `package.json` | Add `"deploy"` script |
| `.gitignore` | Add `bundled/` |
| `src/middleware.ts` | No changes — already handles null Supabase |
| `src/lib/supabase.ts` | No changes — uses `astro:env/server` correctly |

---

## Verification Checklist

1. `npx wrangler deploy --dry-run --outdir bundled/` exits 0 (no node:* errors)
2. `wrangler dev` serves app at `localhost:8787` with working auth
3. Production URL — React hydrates without console errors
4. `npx wrangler tail` shows 200s for smoke-test requests
5. Push to `master` triggers CI → deploy automatically
6. `npx wrangler rollback` reverts in <30s

---

## Open Decisions

1. **Worker name** — Rename `10x-astro-starter` → `10xcards` before first deploy? *(Recommend: yes)*
2. **Supabase region** — Where is the instance hosted? If cross-region, enable Smart Placement later.
3. **Paid plan** — Free tier (10ms CPU, 100k req/day) is fine for MVP. Upgrade to $5/mo if AI endpoints hit CPU ceiling.
