import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcAlias = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcAlias,
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": srcAlias,
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.{ts,tsx}"],
          setupFiles: ["./test/setup/env.ts"],
        },
      },
      {
        resolve: {
          alias: {
            "@": srcAlias,
          },
        },
        test: {
          name: "integration",
          environment: "jsdom",
          include: ["src/**/*.integration.test.{ts,tsx}", "test/**/*.integration.test.{ts,tsx}"],
          setupFiles: ["./test/setup/env.ts", "./test/setup/jest-dom.ts"],
          globalSetup: ["./test/setup/global-integration.ts"],
          testTimeout: 30000,
        },
      },
    ],
  },
});
