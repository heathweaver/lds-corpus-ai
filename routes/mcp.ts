import { define } from "../utils.ts";
import { checkMcpAuth } from "../lib/mcp/auth.ts";
import { handleRpc, type JsonRpcRequest } from "../lib/mcp/server.ts";

// POST /mcp — JSON-RPC 2.0 MCP endpoint for AI runtimes (service-token auth).
// Exempt from the Twiglit session gate (see routes/_middleware.ts); it has its
// own machine auth.
export const handler = define.handlers({
  async POST(ctx) {
    const auth = checkMcpAuth(ctx.req);
    if (!auth.ok) {
      const headers = auth.status === 401
        ? { "www-authenticate": 'Bearer realm="lds-corpus-mcp"' }
        : undefined;
      return Response.json({ error: "mcp_auth", message: auth.message }, {
        status: auth.status,
        headers,
      });
    }

    let body: JsonRpcRequest | JsonRpcRequest[];
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        { status: 400 },
      );
    }

    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleRpc))).filter((r) =>
        r !== null
      );
      return out.length === 0
        ? new Response(null, { status: 202 })
        : Response.json(out);
    }
    const out = await handleRpc(body);
    return out === null
      ? new Response(null, { status: 202 })
      : Response.json(out);
  },

  GET() {
    return new Response(
      "MCP endpoint — POST JSON-RPC 2.0 with a Bearer service token.",
      {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  },
});
