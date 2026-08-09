import { define } from "../utils.ts";

/**
 * Content-Security-Policy for the research UI.
 *
 * Adapted from twiglit-notes (lib/csp.ts). The corpus reader renders source
 * text from the database; the policy makes any injected markup unable to run
 * script while leaving the app's own rendering intact. `script-src` is locked
 * to Fresh's per-render nonce; an injected `<script>` has no nonce so the
 * browser refuses to run it. Inline styles stay permitted for dynamic layout.
 */

/** Symbol Fresh uses to hand the render nonce to CSP middleware.
 * Matches `Symbol.for("__freshNonce")` in @fresh/core. */
const NONCE_SYMBOL = Symbol.for("__freshNonce");

export function buildPolicy(nonce: string | undefined): string {
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** App-level middleware that stamps the CSP header onto every response. */
export const csp = define.middleware(async (ctx) => {
  const res = await ctx.next();
  if (res.status === 101) return res;
  if (res.headers.has("Content-Security-Policy")) return res;
  const nonce = (res as unknown as Record<symbol, string | undefined>)[
    NONCE_SYMBOL
  ];
  res.headers.set("Content-Security-Policy", buildPolicy(nonce));
  return res;
});
