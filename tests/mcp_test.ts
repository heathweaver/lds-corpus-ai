import { assert, assertEquals } from "@std/assert";
import { handleRpc, SERVER_INFO } from "../lib/mcp/server.ts";
import { checkMcpAuth } from "../lib/mcp/auth.ts";

Deno.test("initialize returns server info + tools capability", async () => {
  const r = await handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  }) as {
    result: { serverInfo: unknown; capabilities: { tools: unknown } };
  };
  assertEquals(r.result.serverInfo, SERVER_INFO);
  assert(r.result.capabilities.tools !== undefined);
});

Deno.test("tools/list advertises the research tools", async () => {
  const r = await handleRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  }) as {
    result: { tools: { name: string }[] };
  };
  const names = r.result.tools.map((t) => t.name);
  for (
    const expected of [
      "research_ask",
      "generate_theme",
      "search_corpus",
      "search",
      "fetch",
    ]
  ) {
    assert(names.includes(expected), `missing tool ${expected}`);
  }
});

Deno.test("unknown tool call is an isError result, not a transport error", async () => {
  const r = await handleRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "does_not_exist", arguments: {} },
  }) as { result: { isError: boolean } };
  assertEquals(r.result.isError, true);
});

Deno.test("notifications get no response", async () => {
  const r = await handleRpc({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assertEquals(r, null);
});

Deno.test("unknown method yields JSON-RPC method-not-found", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 4, method: "bogus" }) as {
    error: { code: number };
  };
  assertEquals(r.error.code, -32601);
});

Deno.test("mcp auth fails closed without a configured token", () => {
  Deno.env.delete("MCP_SERVICE_TOKEN");
  const res = checkMcpAuth(
    new Request("http://x/mcp", { headers: { authorization: "Bearer x" } }),
  );
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.status, 503);
});

Deno.test("mcp auth accepts the configured token, rejects others", () => {
  Deno.env.set("MCP_SERVICE_TOKEN", "s3cret,rotated");
  const good = checkMcpAuth(
    new Request("http://x/mcp", {
      headers: { authorization: "Bearer rotated" },
    }),
  );
  assertEquals(good.ok, true);
  const bad = checkMcpAuth(
    new Request("http://x/mcp", { headers: { authorization: "Bearer nope" } }),
  );
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.status, 401);
  Deno.env.delete("MCP_SERVICE_TOKEN");
});
