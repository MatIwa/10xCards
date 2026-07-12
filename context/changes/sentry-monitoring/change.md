---
change_id: sentry-monitoring
title: Add Sentry error monitoring integration
status: implemented
created: 2026-07-12
updated: 2026-07-12
archived_at: null
---

## Notes

Configure Sentry SDK for Astro 6 on Cloudflare Workers to capture server-side errors, console warnings, and client-side exceptions. Set up custom entry point wrapper to integrate with Sentry's `withSentry()` handler. Install @sentry/astro and @sentry/cloudflare packages, configure DSN via environment variables, and enable captureConsoleIntegration for console.warn/error logging.

### References
- User guidance on Sentry + Astro 6 + Cloudflare setup
- Sentry issue #19762 (Astro 6 adapter integration)
- Free Developer plan: 5000 errors/month, 30-day retention
