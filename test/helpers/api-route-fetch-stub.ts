import type { APIContext } from "astro";
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

function createCookieSink(): APIContext["cookies"] {
  return {
    set() {
      return undefined;
    },
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
        cookies: createCookieSink(),
        locals: {
          user: { id: userId },
        },
      } as unknown as APIContext;

      return POST(context);
    }

    return originalFetch(input, init);
  });
}
