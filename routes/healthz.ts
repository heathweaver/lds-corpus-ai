import { define } from "../utils.ts";
import { isDbConfigured } from "../lib/db/postgres-base.ts";

// Liveness + config probe. Always 200 so the platform keeps the instance up;
// the body reports whether DB credentials are present.
export const handler = define.handlers({
  GET() {
    return Response.json({ status: "ok", db: isDbConfigured() ? "configured" : "unconfigured" });
  },
});
