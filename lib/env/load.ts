import { loadSync } from "@std/dotenv";

// Load a local .env into Deno.env for dev / scripts. No-op when the file is
// absent (production runs on Deno Deploy where env comes from the platform).
// An explicit ENV_FILE override wins; otherwise use ./.env in the cwd.
let loaded = false;

export function ensureEnvLoaded(): void {
  if (loaded) return;
  const envPath = Deno.env.get("ENV_FILE") ?? `${Deno.cwd()}/.env`;
  try {
    loadSync({ envPath, export: true });
  } catch (err) {
    // Loading a local .env is best-effort: a missing file is the normal
    // production case, and a sandbox without read/env permission (e.g. a unit
    // test) should not crash on import. Anything else is a real fault.
    const benign = err instanceof Deno.errors.NotFound ||
      err instanceof Deno.errors.NotCapable ||
      err instanceof Deno.errors.PermissionDenied;
    if (!benign) throw err;
  }
  loaded = true;
}

ensureEnvLoaded();
