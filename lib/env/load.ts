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
    // Missing file is the normal production case; anything else is a real
    // fault and should surface rather than masquerade as "no env".
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  loaded = true;
}

ensureEnvLoaded();
