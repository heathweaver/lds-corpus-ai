import { DbNotConfiguredError } from "./db/postgres-base.ts";
import { SegmentSourceUnavailableError } from "./corpus/segments.ts";

/**
 * Run an API handler body, mapping known infrastructure gaps to clean HTTP
 * responses instead of 500s:
 *   - missing DB credentials            -> 503 (service not configured)
 *   - segment source view not found     -> 503 (schema not ready)
 * Anything else re-throws to Fresh's default 500 handling.
 */
export async function withApiErrors(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) {
      return Response.json(
        { error: "database_unconfigured", message: err.message },
        { status: 503 },
      );
    }
    if (err instanceof SegmentSourceUnavailableError) {
      return Response.json(
        { error: "schema_unavailable", message: err.message },
        { status: 503 },
      );
    }
    console.error("Unhandled API error:", err);
    return Response.json(
      { error: "internal_error", message: "Unexpected server error." },
      { status: 500 },
    );
  }
}

export function badRequest(message: string): Response {
  return Response.json({ error: "bad_request", message }, { status: 400 });
}

export function notFound(message = "Not found"): Response {
  return Response.json({ error: "not_found", message }, { status: 404 });
}
