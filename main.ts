import "./lib/env/load.ts";

import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { csp } from "./lib/csp.ts";

export const app = new App<State>({ root: import.meta.url });

// Enforce CSP in production only. The Vite dev server (`deno task dev`) injects
// its own HMR client/websocket that a strict policy would fight; dev is local
// and not a security boundary, so skip it there. Vite replaces this literal at
// build time, defaulting to "enforce" if it is ever undefined.
const isDev =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
if (!isDev) {
  app.use(csp);
}

app.use(staticFiles());

// File-system based routes under ./routes.
app.fsRoutes();
