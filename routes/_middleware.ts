import { define } from "../utils.ts";
import { authHandoffUrl, gate, publicRequestUrl } from "../lib/twiglit/auth.ts";

/** Paths reachable without a Twiglit session (health probe). */
const PUBLIC_PATHS = new Set(["/healthz"]);

/**
 * Twiglit session gate. When TWIGLIT_APP_URL is configured, every route below
 * requires a logged-in Twiglit user (see lib/twiglit/auth.ts). Browser
 * navigations are bounced to Twiglit's session-bridge for SSO; API/JSON calls
 * get a 401/403. When unconfigured, the gate is a no-op (standalone mode).
 */
export const handler = define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  if (PUBLIC_PATHS.has(url.pathname)) return ctx.next();

  const result = await gate(ctx.req);
  if (result.ok) {
    ctx.state.user = result.user;
    return ctx.next();
  }

  const wantsHtml = ctx.req.method === "GET" &&
    (ctx.req.headers.get("accept") ?? "").includes("text/html");

  if (result.reason === "unauthenticated" && wantsHtml) {
    // Build the redirect by hand: Response.redirect() produces immutable
    // headers, which the app-level CSP middleware then can't stamp onto.
    return new Response(null, {
      status: 302,
      headers: { location: authHandoffUrl(publicRequestUrl(ctx.req)) },
    });
  }
  const status = result.reason === "forbidden" ? 403 : 401;
  return Response.json(
    {
      error: result.reason,
      message: result.reason === "forbidden"
        ? "Your Twiglit account is not permitted to use this app."
        : "Twiglit sign-in required.",
    },
    { status },
  );
});
