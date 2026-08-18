# Registering `lds-corpus` in heathweaver/twiglit

These files register the LDS Corpus Research app as a Twiglit plugin (a
marketplace card + `workspace_plugins` install row + an `install_lds_corpus`
MCP tool). They target Twiglit's internal modules, so they belong **in the
`heathweaver/twiglit` repo**, not this one. Copy them in and apply the four
edits below.

## Copy files (paths relative to the twiglit repo root)

- `lib/plugins/lds-corpus/index.ts`
- `routes/api/v1/plugins/lds-corpus/install.ts`

(Both mirror the `twiglit-loam` equivalents exactly, with names swapped.)

## Edit 1 — add to the plugin catalog

`lib/plugins/catalog.ts`:

```ts
import { ldsCorpusPlugin } from "./lds-corpus/index.ts";

export const PLUGIN_CATALOG: PluginDefinition[] = [
  // …existing entries…
  ldsCorpusPlugin,
];
```

## Edit 2 — wire the install MCP tool into the registry

`lib/mcp/registry.ts` (mirror how `install_twiglit_loam` is wired):

```ts
import { mcpTools as ldsCorpusInstallTools } from "../../routes/api/v1/plugins/lds-corpus/install.ts";
// …register ldsCorpusInstallTools alongside the others…
// and add the write annotation:
//   install_lds_corpus: WRITE_ANNOTATIONS
```

## Edit 3 — register the route for OpenAPI

`lib/api/v1/openapi-routes.ts`: add the import so the co-located
`registerRoute(...)` in the install handler runs:

```ts
import "../../routes/api/v1/plugins/lds-corpus/install.ts";
```

## Edit 4 (optional) — feature it in the marketplace

`lib/marketplace/catalog.ts`:

```ts
const FEATURED_EXTENSIONS = new Set(["twiglit-loam", "every-15-minutes", "lds-corpus"]);
```

## Notes

- The install endpoint requires the `twigs:write` scope (same as loam). If the
  app should self-install after OAuth, request `twigs:write` in its authorize
  step; otherwise install from the team plugins page or by having the in-Twiglit
  agent call `install_lds_corpus`.
- This registration is **read-only** — the app does not push to Twiglit. It
  gates its own UI to the Twiglit user (see `lib/twiglit/auth.ts` in the app).
