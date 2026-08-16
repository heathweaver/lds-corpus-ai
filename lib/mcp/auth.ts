/**
 * Service-token auth for the /mcp endpoint (machine-to-machine).
 *
 * The Twiglit runtime (and other AI clients) authenticate with a static
 * service token: `Authorization: Bearer <MCP_SERVICE_TOKEN>`. Fails closed —
 * when MCP_SERVICE_TOKEN is unset the endpoint is disabled (503), so /mcp is
 * never open by accident. Multiple tokens can be provided comma-separated to
 * allow rotation.
 */

function tokens(): string[] {
  return (Deno.env.get("MCP_SERVICE_TOKEN") ?? "")
    .split(",").map((t) => t.trim()).filter(Boolean);
}

export function mcpConfigured(): boolean {
  return tokens().length > 0;
}

export type McpAuth =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function checkMcpAuth(req: Request): McpAuth {
  const allowed = tokens();
  if (allowed.length === 0) {
    return {
      ok: false,
      status: 503,
      message: "MCP endpoint is not configured (set MCP_SERVICE_TOKEN).",
    };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const presented = match?.[1]?.trim();
  if (!presented || !allowed.includes(presented)) {
    return {
      ok: false,
      status: 401,
      message: "Valid Bearer service token required.",
    };
  }
  return { ok: true };
}
