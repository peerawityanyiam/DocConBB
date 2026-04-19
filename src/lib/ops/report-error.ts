import { logEvent } from './observability';

/**
 * Report an unexpected error to a single structured log line.
 *
 * Output goes through `logEvent` (structured JSON on console.error),
 * which Vercel Runtime Logs captures. Search by `scope`, `requestId`,
 * or any meta field in the Vercel dashboard.
 *
 * This is the ONLY place to extend if we later integrate Sentry,
 * Logflare, Axiom, or a webhook — every catch block in the app funnels
 * through here via `handleAuthError`.
 */
export function reportError(
  scope: string,
  requestId: string,
  err: unknown,
  meta?: Record<string, unknown>,
) {
  const e = err instanceof Error ? err : new Error(String(err));
  logEvent('error', scope, requestId, e.message, {
    ...meta,
    errorName: e.name,
    stack: e.stack,
  });
  // Hook point: future external reporters attach here.
  // if (process.env.SENTRY_DSN) { ... }
}
