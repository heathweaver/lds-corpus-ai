import { TOOL_MAP, TOOLS } from "./tools.ts";

/**
 * Minimal MCP (Model Context Protocol) JSON-RPC 2.0 handler.
 *
 * Implements the methods an AI runtime needs to discover and call our research
 * tools: initialize, tools/list, tools/call, ping. Tool results are returned in
 * MCP shape (content + structuredContent); tool errors are reported as
 * isError results (not transport errors), per the MCP spec.
 */

export const SERVER_INFO = { name: "lds-corpus-research", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2024-11-05";

// deno-lint-ignore no-explicit-any
type Json = any;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Json;
}

function result(id: Json, value: Json) {
  return { jsonrpc: "2.0", id, result: value };
}
function rpcError(id: Json, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Handle one JSON-RPC message. Returns null for notifications (no response). */
export async function handleRpc(req: JsonRpcRequest): Promise<object | null> {
  const { id, method, params } = req ?? {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const tool = TOOL_MAP.get(params?.name);
      if (!tool) {
        return result(id, {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${params?.name}` }],
        });
      }
      try {
        const value = await tool.handler(params?.arguments ?? {});
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
        });
      } catch (err) {
        return result(id, {
          isError: true,
          content: [{
            type: "text",
            text: (err as Error).message ?? "Tool error",
          }],
        });
      }
    }

    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
