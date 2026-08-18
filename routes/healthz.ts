import { define } from "../utils.ts";
import { isDbConfigured } from "../lib/db/postgres-base.ts";
import { mcpConfigured } from "../lib/mcp/auth.ts";

// Liveness + config probe. Always 200 so the platform keeps the instance up;
// the body reports whether DB credentials and the MCP endpoint are configured.
export const handler = define.handlers({
  GET() {
    return Response.json({
      status: "ok",
      db: isDbConfigured() ? "configured" : "unconfigured",
      mcp: mcpConfigured() ? "enabled" : "disabled",
    });
  },
});
