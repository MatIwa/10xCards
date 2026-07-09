import type { APIContext } from "astro";
import { parseCookieHeader } from "@supabase/ssr";

type ApiRouteHandler = (context: APIContext) => Response | Promise<Response>;

interface InvokeApiRouteOptions<TBody = unknown> {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pathname: string;
  params?: Record<string, string>;
  body?: TBody;
  session?: {
    userId: string;
    cookieHeader: string;
  };
  handler: ApiRouteHandler;
}

// Reads mirror the request Cookie header; writes are no-ops because these tests
// do not exercise Supabase token refresh flows.
export function createCookieSink(cookieHeader = ""): APIContext["cookies"] {
  const parsed = cookieHeader
    ? parseCookieHeader(cookieHeader).map(({ name, value }) => ({
        name,
        value: value ?? "",
      }))
    : [];

  return {
    get: (name: string) => {
      const entry = parsed.find((cookie) => cookie.name === name);
      return entry ? { value: entry.value } : undefined;
    },
    getAll: () => parsed.map(({ name, value }) => ({ name, value })),
    has: (name: string) => parsed.some((cookie) => cookie.name === name),
    set: () => undefined,
    delete: () => undefined,
    merge: () => undefined,
    headers: () => [] as string[],
  } as unknown as APIContext["cookies"];
}

function createRouteRequest<TBody>({ method, pathname, body, session }: InvokeApiRouteOptions<TBody>) {
  const headers = new Headers();

  if (session) {
    headers.set("Cookie", session.cookieHeader);
  }

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return new Request(new URL(pathname, "http://localhost"), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function invokeApiRoute<TBody = unknown>(options: InvokeApiRouteOptions<TBody>): Promise<Response> {
  const request = createRouteRequest(options);
  const context = {
    request,
    url: new URL(options.pathname, "http://localhost"),
    cookies: createCookieSink(options.session?.cookieHeader),
    params: options.params ?? {},
    locals: {
      user: options.session ? { id: options.session.userId } : null,
    },
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext;

  return options.handler(context);
}
