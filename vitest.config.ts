import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcAlias = fileURLToPath(new URL("./src", import.meta.url));
const astroEnvServerAlias = fileURLToPath(new URL("./test/setup/astro-env-server.ts", import.meta.url));
const astroMiddlewareAlias = fileURLToPath(new URL("./test/setup/astro-middleware.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcAlias,
      "astro:env/server": astroEnvServerAlias,
      "astro:middleware": astroMiddlewareAlias,
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": srcAlias,
            "astro:env/server": astroEnvServerAlias,
            "astro:middleware": astroMiddlewareAlias,
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.{ts,tsx}"],
        },
      },
      {
        resolve: {
          alias: {
            "@": srcAlias,
            "astro:env/server": astroEnvServerAlias,
            "astro:middleware": astroMiddlewareAlias,
          },
        },
        test: {
          name: "integration",
          environment: "jsdom",
          include: ["src/**/*.integration.test.{ts,tsx}", "test/**/*.integration.test.{ts,tsx}"],
          setupFiles: ["./test/setup/jest-dom.ts"],
          globalSetup: ["./test/setup/global-integration.ts"],
          testTimeout: 30000,
        },
      },
    ],
  },
});
