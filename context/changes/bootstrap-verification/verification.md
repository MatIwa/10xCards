---
bootstrapped_at: 2026-05-27T12:00:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

10x Astro Starter delivers auth, database, and edge deployment pre-configured for a solo developer on a 3-week after-hours timeline. Astro 6 with React 19 islands provides a content-first architecture that ships minimal client JS while supporting interactive UI where needed. Supabase covers PostgreSQL persistence, row-level security, and auth — all three PRD requirements (user accounts, flashcard storage, privacy) without additional service selection. Cloudflare Pages/Workers gives zero-config edge deployment with auto-deploy on merge via GitHub Actions. TypeScript end-to-end with Zod schemas at API boundaries satisfies all four agent-friendly criteria (typed, convention-based, popular in training data, well-documented), meaning AI coding agents can reason about the codebase from source alone. The AI generation feature (calling an LLM provider for flashcard extraction) integrates naturally as an Astro API route with typed request/response contracts.

## Pre-scaffold verification

| Signal        | Value                                              | Severity | Notes                                            |
| ------------- | -------------------------------------------------- | -------- | ------------------------------------------------ |
| npm package   | not run                                            | —        | cmd_template uses git clone, not npm create CLI  |
| GitHub repo   | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh    | from card.docs_url; 10 days ago at bootstrap time |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 48 source files + node_modules (773 packages)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (absent in cwd prior to scaffold)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0 (transitive) — DoS via sparse array deserialization. Advisory: GHSA-77vg-94rm-hx3p. Fix available via `npm audit fix`.

#### MODERATE findings

- **@astrojs/check** (direct) — via @astrojs/language-server. Fix: downgrade to 0.9.2 (semver-major).
- **@astrojs/language-server** (transitive) — via volar-service-yaml.
- **@cloudflare/vite-plugin** (transitive) — via miniflare, wrangler, ws. Fix available.
- **miniflare** (transitive) — via ws. Fix available.
- **volar-service-yaml** (transitive) — via yaml-language-server.
- **wrangler** (direct) — via miniflare. Fix available.
- **ws** (transitive) — Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx). Fix available.
- **yaml** (transitive) — Stack Overflow via deeply nested collections (GHSA-48c2-rrv3-qjmp).
- **yaml-language-server** (transitive) — via yaml.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
