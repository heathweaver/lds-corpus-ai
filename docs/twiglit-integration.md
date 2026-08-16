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

## Optional: consuming Twiglit twigs (future)

If the app should read the user's twigs (e.g. "research this twig" or "save a
cited passage into a twig"), add an OAuth 2.1 PKCE client mirroring loam's
`lib/extensions/twiglit/{oauth,api,mcp}.ts`: dynamic-register at
`POST /oauth/register`, authorize (`S256`) at `/oauth/authorize`, exchange at
`/oauth/token`, then call `/api/v1/twigs*` with the bearer token. Request
`twigs:write` if the app should also self-install or write back.
