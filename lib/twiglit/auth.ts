/**
 * Twiglit session gate — makes this app a loam-style Twiglit extension.
 *
 * Mirrors twiglit-notes' lib/loam-auth.ts. When TWIGLIT_APP_URL is set the
 * app's own web UI is gated to logged-in Twiglit users: the incoming `session`
 * cookie is forwarded to Twiglit's `GET /api/auth/me`, and access is granted
 * per the configured policy. Fails closed. When TWIGLIT_APP_URL is unset the
 * app runs standalone (no gating) — so the same build serves both modes.
 *
 *   TWIGLIT_APP_URL        Twiglit origin (e.g. https://app.twigl.it). Gate on.
 *   TWIGLIT_AUTH_DISABLED  "true" bypasses the gate (local dev).
 *   TWIGLIT_ACCESS         any | super_admin | allowlist   (default: any)
 *   TWIGLIT_ALLOWED_EMAILS comma-separated emails (for allowlist policy)
 */

export interface TwiglitUser {
  id: string;
  email: string;
  display_name: string;
  is_super_admin: boolean;
  plan_tier: "free" | "paid";
}

export function twiglitAppUrl(): string | null {
  const url = Deno.env.get("TWIGLIT_APP_URL")?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

/** Gating is active only when a Twiglit origin is configured and not disabled. */
export function gateEnabled(): boolean {
  if (Deno.env.get("TWIGLIT_AUTH_DISABLED") === "true") return false;
  return twiglitAppUrl() !== null;
}

export async function fetchTwiglitUser(
  req: Request,
): Promise<TwiglitUser | null> {
  const app = twiglitAppUrl();
  if (!app) return null;
  const cookie = req.headers.get("cookie");
  if (!cookie?.includes("session=")) return null;
  try {
    const res = await fetch(`${app}/api/auth/me`, {
      headers: { cookie },
      redirect: "manual",
    });
    if (!res.ok) return null;
    const body = await res.json() as { user?: TwiglitUser };
    return body.user ?? null;
  } catch (err) {
    console.error("[twiglit-auth] /api/auth/me failed:", err);
    return null;
  }
}

/** Apply the configured access policy to an authenticated Twiglit user. */
export function canAccess(user: TwiglitUser): boolean {
  switch ((Deno.env.get("TWIGLIT_ACCESS") ?? "any").toLowerCase()) {
    case "super_admin":
      return user.is_super_admin;
    case "allowlist": {
      const allowed = (Deno.env.get("TWIGLIT_ALLOWED_EMAILS") ?? "")
        .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      return allowed.includes(user.email.toLowerCase());
    }
    default:
      return true; // any authenticated Twiglit user
  }
}

/** SSO handoff: reuse the Twiglit session or continue to login, then return. */
export function authHandoffUrl(returnTo: string): string {
  const app = twiglitAppUrl() ?? "http://localhost:5173";
  const bridge = new URL("/api/auth/session-bridge", app);
  bridge.searchParams.set("return_to", returnTo);
  return bridge.toString();
}

/** The request's public https URL, honoring a tunnel's X-Forwarded-Proto. */
export function publicRequestUrl(req: Request): string {
  const url = new URL(req.url);
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) {
    url.protocol = `${fwd.split(",")[0].trim()}:`;
  } else if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    url.protocol = "https:";
  }
  return url.toString();
}

export type GateResult =
  | { ok: true; user: TwiglitUser | null }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/** Resolve the gate for a request (no-op pass when gating is disabled). */
export async function gate(req: Request): Promise<GateResult> {
  if (!gateEnabled()) return { ok: true, user: null };
  const user = await fetchTwiglitUser(req);
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (!canAccess(user)) return { ok: false, reason: "forbidden" };
  return { ok: true, user };
}
