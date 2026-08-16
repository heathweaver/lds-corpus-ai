# Twiglit integration

This app runs as a **Twiglit extension** in the same way `twiglit-notes` (loam)
does: a separate deployment whose UI is gated to logged-in Twiglit users, and
which is registered in Twiglit's plugin catalog so it appears in the
marketplace. Twiglit's extension model is a **compile-time plugin catalog**, not
a UI-embedding host — Twiglit does not iframe or call external apps, and it does
not register external MCP servers. So integration has two sides.

## App side (this repo) — session gate

`lib/twiglit/auth.ts` + `routes/_middleware.ts` gate every route (except
`/healthz`) to a Twiglit user by forwarding the incoming `session` cookie to
`TWIGLIT_APP_URL/api/auth/me`. Browser navigations that aren't signed in are
bounced to Twiglit's `/api/auth/session-bridge?return_to=…` for SSO; API/JSON
calls get `401`/`403`.

Config (env):

| Var | Meaning |
| --- | ------- |
| `TWIGLIT_APP_URL` | Twiglit origin, e.g. `https://app.twigl.it`. **Setting it turns the gate on.** Unset = standalone (no gating). |
| `TWIGLIT_AUTH_DISABLED` | `true` bypasses the gate (local dev). |
| `TWIGLIT_ACCESS` | `any` (default), `super_admin`, or `allowlist`. |
| `TWIGLIT_ALLOWED_EMAILS` | comma-separated emails, for `allowlist`. |

Deploy the app on a `*.twigl.it` subdomain (so the session cookie is sent) —
loam runs behind a Cloudflare tunnel at `loam.twigl.it`; a Deno Deploy custom
domain under `twigl.it` works too. The cookie domain must cover the subdomain.

## Twiglit side (a PR into heathweaver/twiglit)

Register the plugin so it shows up as installable. The ready-to-PR files and the
exact edits are in **`twiglit-plugin/`** (see `twiglit-plugin/PATCH.md`):

- `lib/plugins/lds-corpus/index.ts` — the `PluginDefinition`
- `routes/api/v1/plugins/lds-corpus/install.ts` — install handler +
  `install_lds_corpus` MCP tool (upserts `workspace_plugins`)
- edits to `lib/plugins/catalog.ts`, `lib/mcp/registry.ts`,
  `lib/api/v1/openapi-routes.ts`, and optionally `lib/marketplace/catalog.ts`

## Runtime research via MCP — the Twiglit AI querying the corpus

The Twiglit runtime (and any AI client) runs rigorous research against the
corpus through the app's own **MCP endpoint**, `POST /mcp` — a JSON-RPC 2.0
Model Context Protocol server that reuses the same verified core as the human
UI. It authenticates with a **service token** (`Authorization: Bearer
<MCP_SERVICE_TOKEN>`), separate from the browser session gate, and `/mcp` is
exempt from that gate. Fails closed: unset `MCP_SERVICE_TOKEN` ⇒ endpoint
disabled (503).

Tools (`tools/list`):

| Tool | Purpose |
| ---- | ------- |
| `research_ask` | Grounded answer to a research question; every claim verified, unsupported claims dropped; returns citations + groundedness report |
| `generate_theme` | Draft a rigorous theme document; every paragraph verified against cited sources (dry run) |
| `search_corpus` | Hybrid keyword+semantic search for concepts/stories/quotes |
| `get_segment` / `get_document` | Read sources in context, with provenance |
| `search_indexes` / `get_index` | Browse the Zettelkasten theme indexes |
| `search` / `fetch` | Deep-research contract pair (ChatGPT-style clients) |

Example:

```bash
curl -sX POST "$APP_URL/mcp" \
  -H "authorization: Bearer $MCP_SERVICE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"research_ask","arguments":{"question":"How is faith described as a principle of action?"}}}'
```

Wiring into the Twiglit runtime: point the runtime's tool layer at
`$APP_URL/mcp` with the service token. Because Twiglit's own extension model is
a compiled catalog (it does not auto-register external MCP servers), the
runtime either (a) calls these endpoints directly as a service, or (b) Twiglit
adds thin internal tools that proxy to them. Both use the same `/mcp` contract
above.

## Optional: consuming Twiglit twigs (future)

If the app should read the user's twigs (e.g. "research this twig" or "save a
cited passage into a twig"), add an OAuth 2.1 PKCE client mirroring loam's
`lib/extensions/twiglit/{oauth,api,mcp}.ts`: dynamic-register at
`POST /oauth/register`, authorize (`S256`) at `/oauth/authorize`, exchange at
`/oauth/token`, then call `/api/v1/twigs*` with the bearer token. Request
`twigs:write` if the app should also self-install or write back.
