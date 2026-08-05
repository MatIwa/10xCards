import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export * from "./config.js";
export * from "./schemas/review.js";
export * from "./prompts/review.js";
export * from "./agent.js";

import { reviewDiff } from "./agent.js";

const USAGE = [
  "Usage:",
  "  npm run dev -- [diff-file] [--files <path> ...]",
  "",
  "Provide a unified diff via stdin or pass a diff file path as the first argument.",
  "Use --files to pass changed file paths for extra context.",
].join("\n");

interface CliArgs {
  diffFile?: string;
  filePaths: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const filePaths: string[] = [];
  let diffFile: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--files") {
      index += 1;

      while (index < argv.length && !argv[index]?.startsWith("--")) {
        filePaths.push(argv[index] ?? "");
        index += 1;
      }

      index -= 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (!diffFile) {
      diffFile = arg;
      continue;
    }

    filePaths.push(arg);
  }

  return { diffFile, filePaths };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function main() {
  let args: CliArgs;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments";
    process.stderr.write(`${message}\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const diff = args.diffFile ? await readFile(args.diffFile, "utf8") : await readStdin();
  const trimmedDiff = diff.trim();

  if (!trimmedDiff) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const review = await reviewDiff({
    diff: trimmedDiff,
    filePaths: args.filePaths.length > 0 ? args.filePaths : undefined,
  });

  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
}

// Node 22 lacks import.meta.main; compare the resolved entry URL instead.
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isDirectRun) {
  void main();
}
