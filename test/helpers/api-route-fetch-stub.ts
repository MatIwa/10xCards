import type { APIContext } from "astro";
import { parseCookieHeader } from "@supabase/ssr";
import { vi } from "vitest";

interface ProposalResponse {
  id: string;
  front: string;
  back: string;
}

interface InstallApiRouteFetchStubOptions {
  userId: string;
  sessionCookie: string;
  generateProposalsResponse: ProposalResponse[];
}

// Astro's APIContext["cookies"] surface is used by supabase.ts (setAll callback
// during token refresh) and would be reached by any API route calling
// `cookies.get()` / `cookies.getAll()` before creating the supabase client.
// Reads are backed by the same session cookie the test sends in the request
// header; writes are no-ops because the test does not exercise refresh flows.
function createCookieSink(sessionCookie: string): APIContext["cookies"] {
  const parsed = parseCookieHeader(sessionCookie).map(({ name, value }) => ({
    name,
    value: value ?? "",
  }));
  return {
    get: (name: string) => {
      const entry = parsed.find((c) => c.name === name);
      return entry ? { value: entry.value } : undefined;
    },
    getAll: () => parsed.map(({ name, value }) => ({ name, value })),
    has: (name: string) => parsed.some((c) => c.name === name),
    set: () => undefined,
    delete: () => undefined,
    merge: () => undefined,
    headers: () => [] as string[],
  } as unknown as APIContext["cookies"];
}

function toRequestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  return new URL(input.toString(), "http://localhost");
}

function toRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function createRouteRequest(url: URL, init: RequestInit | undefined, sessionCookie: string) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", sessionCookie);

  return new Request(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
    signal: init?.signal,
  });
}

export function installApiRouteFetchStub({
  userId,
  sessionCookie,
  generateProposalsResponse,
}: InstallApiRouteFetchStubOptions) {
  const originalFetch = globalThis.fetch.bind(globalThis);

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toRequestUrl(input);
    const method = toRequestMethod(input, init);
    const routeKey = `${method} ${url.pathname}`;

    if (routeKey === "POST /api/flashcards/generate") {
      return Response.json({ proposals: generateProposalsResponse }, { status: 200 });
    }

    if (routeKey === "POST /api/flashcards") {
      const { POST } = await import("@/pages/api/flashcards/index");
      const context = {
        request: createRouteRequest(url, init, sessionCookie),
        cookies: createCookieSink(sessionCookie),
        locals: {
          user: { id: userId },
        },
      } as unknown as APIContext;

      return POST(context);
    }

    return originalFetch(input, init);
  });
}
