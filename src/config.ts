// Central configuration, read once from the environment.
//
// A .env file is loaded for local dev. In production (Deno Deploy) the
// variables come from the deployment environment instead.
import "@std/dotenv/load";

function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

/** Build a postgres connection URL from DATABASE_URL or discrete DB_* parts. */
function resolveDatabaseUrl(): string {
  const direct = env("DATABASE_URL");
  if (direct && !direct.includes("<")) return direct;

  const host = env("DB_HOST", "ssc.pm");
  const port = env("DB_PORT", "5433");
  const name = env("DB_NAME", "lds_corpus");
  const user = env("DB_USER");
  const password = env("DB_PASSWORD");
  const sslmode = env("DB_SSLMODE", "require");

  if (!user || !password) {
    // No usable credentials. Callers surface this as a clear 503 rather than
    // crashing the whole server on boot.
    return "";
  }
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${auth}@${host}:${port}/${name}?sslmode=${sslmode}`;
}

export const config = {
  databaseUrl: resolveDatabaseUrl(),
  /** Postgres schema that holds the corpus (tables + v_segment_source view). */
  schema: env("DB_SCHEMA", "lds_corpus"),
  sslmode: env("DB_SSLMODE", "require"),
  disablePrepare: env("PG_DISABLE_PREPARE", "0") === "1",

  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5"),

  port: Number(env("PORT", "8000")),
} as const;

export function hasDatabase(): boolean {
  return config.databaseUrl.length > 0;
}
