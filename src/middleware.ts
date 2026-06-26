import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard"];
const PROTECTED_API_PREFIXES = ["/api/flashcards", "/api/account"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const isProtectedApiRoute = PROTECTED_API_PREFIXES.some((route) => context.url.pathname.startsWith(route));
  const isProtectedPageRoute = PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route));

  if (isProtectedApiRoute || isProtectedPageRoute) {
    if (!context.locals.user) {
      if (isProtectedApiRoute) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
