---
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
---

## Why this stack

10x Astro Starter delivers auth, database, and edge deployment pre-configured for a solo developer on a 3-week after-hours timeline. Astro 6 with React 19 islands provides a content-first architecture that ships minimal client JS while supporting interactive UI where needed. Supabase covers PostgreSQL persistence, row-level security, and auth — all three PRD requirements (user accounts, flashcard storage, privacy) without additional service selection. Cloudflare Pages/Workers gives zero-config edge deployment with auto-deploy on merge via GitHub Actions. TypeScript end-to-end with Zod schemas at API boundaries satisfies all four agent-friendly criteria (typed, convention-based, popular in training data, well-documented), meaning AI coding agents can reason about the codebase from source alone. The AI generation feature (calling an LLM provider for flashcard extraction) integrates naturally as an Astro API route with typed request/response contracts.
