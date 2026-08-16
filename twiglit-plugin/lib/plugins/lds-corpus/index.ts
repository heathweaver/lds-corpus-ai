import type { PluginDefinition } from "../types.ts";

/**
 * LDS Corpus Research — Twiglit-side plugin definition.
 *
 * A companion research app over a PostgreSQL corpus of Latter-day Saint
 * scripture and early LDS history. Users ask natural-language questions and get
 * grounded answers with verified passage-level citations, browse Zettelkasten
 * theme indexes, and read sources in context. The app runs as its own
 * deployment (like Twiglit Loam) and gates its UI to the logged-in Twiglit
 * user via the session cookie.
 *
 * Read-only consumer for now — no twig writes, no webhooks, no custom fields.
 * Surfacing it in the catalog is the point: it appears in the workspace plugin
 * browser / marketplace so the user can install/open it from inside Twiglit.
 *
 * If bidirectional features are added later (e.g. "save a cited passage into a
 * twig"), wire them here: request `twigs:write` in the app's OAuth flow and add
 * eventHandlers / an install-time webhook as Every 15 Minutes does.
 */
export const ldsCorpusPlugin: PluginDefinition = {
  id: "lds-corpus",
  name: "LDS Corpus Research",
  description:
    "Grounded research over Latter-day Saint scripture and early LDS history: ask questions with verified citations, follow Zettelkasten theme indexes, and read sources in context.",
  version: "0.1.0",

  // Read-only consumer — nothing to register on install yet.
  twigTypes: [],
  customFields: [],
  eventHandlers: [],

  // deno-lint-ignore require-await
  async onInstall(workspaceId: string, _installedBy: string) {
    console.log(`[lds-corpus] installed for workspace=${workspaceId}`);
  },
};
