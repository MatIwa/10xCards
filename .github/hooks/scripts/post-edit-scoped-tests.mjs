#!/usr/bin/env node
// PostToolUse hook: run Vitest related tests when the agent edits a file
// inside the top risk area from context/foundation/test-plan.md.
//
// Risk targeted: #1 (High/High) — "OpenRouter returns malformed / partial /
// schema-drifted JSON; parser fails or feeds empty candidates back to the
// user; the AI generation wedge silently degrades". Evidence anchor:
// hot-spot dir `src/lib/services/ — 7 commits/30d`. The service directory
// also anchors Risks #3 and #5, so this trigger incidentally covers them.
//
// - Filters by `tool_name` (VS Code ignores JSON matchers).
// - Filters by file path prefix — only edits under `src/lib/services/**`
//   fire tests; everything else exits 0 immediately.
// - Runs `vitest related <file> --project unit --run`. `--project unit`
//   avoids the `integration` project's Supabase dependency, keeping the
//   agent loop independent of `npx supabase start`.
// - Sets AI_AGENT=1 so Vitest 4.1+ emits compact output tailored for
//   feeding back into an agent context.
// - Exits 2 on test failure with the runner output on stderr.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, isAbsolute, resolve } from "node:path";

const WRITE_TOOLS = new Set([
  "create_file",
  "replace_string_in_file",
  "multi_replace_string_in_file",
  "edit_notebook_file",
]);

const TESTABLE = /\.(ts|tsx)$/i;

// Risk-area prefix (POSIX form). See header comment for the mapping to
// context/foundation/test-plan.md §2 risks.
const RISK_AREA_PREFIX = "src/lib/services/";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let event = {};
try {
  event = JSON.parse(readStdin());
} catch {
  process.exit(0);
}

if (!WRITE_TOOLS.has(event.tool_name)) process.exit(0);

const rawPath = event.tool_input?.filePath ?? event.tool_input?.file_path;
if (typeof rawPath !== "string" || rawPath.length === 0) process.exit(0);
if (!TESTABLE.test(rawPath)) process.exit(0);

// Normalize to POSIX-style relative path from cwd for a stable prefix check
// (VS Code sometimes sends absolute Windows paths, sometimes cwd-relative).
const cwd = process.cwd();
const abs = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
const rel = relative(cwd, abs).split("\\").join("/");

if (!rel.startsWith(RISK_AREA_PREFIX)) process.exit(0);

const vitestBin = resolve(cwd, "node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestBin, "related", rel, "--project", "unit", "--run"],
  {
    encoding: "utf8",
    env: { ...process.env, AI_AGENT: "1" },
  },
);

if (result.status === 0) process.exit(0);

process.stderr.write(`Scoped tests failed for ${rel}:\n`);
if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(2);
