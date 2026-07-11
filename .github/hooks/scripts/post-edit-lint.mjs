#!/usr/bin/env node
// PostToolUse hook: run ESLint (--fix) on the file the agent just edited.
// - Reads the hook event JSON from stdin.
// - Filters to file-modification tools only (VS Code ignores the JSON `matcher`
//   field, so we filter ourselves via `tool_name`).
// - Exits 0 on success (silent — anything on stdout must be valid JSON).
// - Exits 2 on lint failure and writes the ESLint report to stderr so the
//   agent sees it as `additionalContext` and can self-correct next turn.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, isAbsolute, resolve } from "node:path";

const WRITE_TOOLS = new Set([
  "create_file",
  "replace_string_in_file",
  "multi_replace_string_in_file",
  "edit_notebook_file",
]);

// Match the same extensions that `lint-staged` runs ESLint on (see
// `package.json` → `lint-staged`). Widening this to `.js`/`.mjs` triggers
// false positives from typescript-eslint's `strictTypeChecked` project
// service on files outside `tsconfig` (e.g. this hook script itself).
const LINTABLE = /\.(ts|tsx|astro)$/i;

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
if (!LINTABLE.test(rawPath)) process.exit(0);

// ESLint handles absolute paths fine, but relative paths keep the report
// terse; convert when the file is inside cwd.
const cwd = process.cwd();
const target =
  isAbsolute(rawPath) && rawPath.toLowerCase().startsWith(cwd.toLowerCase())
    ? relative(cwd, rawPath) || rawPath
    : rawPath;

// Invoke ESLint's JS entrypoint directly with the current node binary.
// - Skips the `npx` / shim resolution overhead on Windows.
// - `--cache` reuses per-file results so subsequent hook runs on unchanged
//   files are near-instant. Cache is stored under `node_modules/.cache/`
//   (already gitignored) rather than the default `.eslintcache` in cwd.
const eslintBin = resolve(cwd, "node_modules/eslint/bin/eslint.js");
const cacheLocation = resolve(cwd, "node_modules/.cache/eslint/hook.json");
const result = spawnSync(
  process.execPath,
  [
    eslintBin,
    "--fix",
    "--cache",
    "--cache-location",
    cacheLocation,
    target,
  ],
  { encoding: "utf8" },
);

if (result.status === 0) process.exit(0);

process.stderr.write(`ESLint reported issues in ${target}:\n`);
if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(2);
