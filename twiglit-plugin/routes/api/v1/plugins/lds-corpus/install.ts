import { define } from "../../../../../utils.ts";
import sql from "../../../../../db/client.ts";
import {
  authenticateRequest,
  checkScope,
  withRateHeaders,
} from "../../../../../lib/api/v1/middleware.ts";
import { envelope } from "../../../../../lib/api/v1/pagination.ts";
import { badRequest } from "../../../../../lib/api/v1/errors.ts";
import type { McpToolDef } from "../../../../../lib/mcp/registry.ts";
import { ldsCorpusPlugin } from "../../../../../lib/plugins/lds-corpus/index.ts";
import { registerRoute } from "../../../../../lib/api/v1/registry.ts";

// ─── OpenAPI registration (co-located with the handler) ───────────
registerRoute({
  method: "post",
  path: "/api/v1/plugins/lds-corpus/install",
  tags: ["plugins"],
  scope: "twigs:write",
  summary: "Install the LDS Corpus Research plugin for the caller's workspace.",
  responses: {
    200: { description: "Install result" },
    400: { description: "Install failed" },
  },
});

/**
 * POST /api/v1/plugins/lds-corpus/install
 *
 * Registers a workspace_plugins row for the caller's workspace and runs the
 * plugin's onInstall hook. Idempotent: re-calling updates installed_at +
 * installed_by in place. Read-only consumer — no webhook is registered.
 */
export const mcpTools: McpToolDef[] = [
  {
    name: "install_lds_corpus",
    description:
      "Install (or update) the LDS Corpus Research plugin for the caller's workspace. Registers the plugin in workspace_plugins so it appears installed in the Twiglit UI. Idempotent.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    scope: "twigs:write",
    handler: async (_args, userId) => {
      return await installLdsCorpus(userId);
    },
  },
];

export const handler = define.handlers({
  async POST(ctx) {
    const auth = await authenticateRequest(ctx.req);
    if (auth instanceof Response) return auth;
    const { user, rateHeaders } = auth;

    const scopeErr = checkScope(user, "twigs:write");
    if (scopeErr) return scopeErr;

    try {
      const result = await installLdsCorpus(user.id);
      return withRateHeaders(envelope(result), rateHeaders);
    } catch (err) {
      console.error("POST /api/v1/plugins/lds-corpus/install error:", err);
      return badRequest((err as Error).message ?? "Install failed");
    }
  },
});

interface InstallResult {
  plugin_id: "lds-corpus";
  workspace_id: string;
  ready: boolean;
}

async function installLdsCorpus(userId: string): Promise<InstallResult> {
  const [userRow] = await sql`
    SELECT id FROM trees
    WHERE owner_id = ${userId} AND kind = 'workspace'
    LIMIT 1
  `;
  const workspaceId = userRow?.id as string | undefined;
  if (!workspaceId) {
    throw new Error("User has no workspace tree — cannot install plugin");
  }

  const config = { ready: true };
  await sql`
    INSERT INTO workspace_plugins (workspace_id, plugin_id, installed_by, config)
    VALUES (
      ${workspaceId},
      ${ldsCorpusPlugin.id},
      ${userId},
      ${sql.json(config as never)}
    )
    ON CONFLICT (workspace_id, plugin_id) DO UPDATE
      SET installed_by = EXCLUDED.installed_by,
          installed_at = now(),
          config = EXCLUDED.config
  `;

  if (ldsCorpusPlugin.onInstall) {
    try {
      await ldsCorpusPlugin.onInstall(workspaceId, userId);
    } catch (err) {
      console.warn("[lds-corpus] onInstall hook failed:", (err as Error).message);
    }
  }

  return { plugin_id: "lds-corpus", workspace_id: workspaceId, ready: true };
}
