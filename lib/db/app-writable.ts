import "../env/load.ts";
import postgres from "postgres";
import { SCHEMA } from "./postgres-base.ts";

/**
 * Optional WRITABLE connection for internal jobs (curation) and demand logging.
 *
 * Bound to the least-privilege `lds_corpus_curator` role (see
 * sql/curator_role.sql): it can read all of lds_corpus, write the knowledge-base
 * tables, and owns the `corpus_ai` operational schema. It is created lazily and
 * is entirely optional — when no APP_* credentials are configured, getAppSql()
 * returns null and writers (e.g. query logging) become silent no-ops, so the
 * public read-only app is unaffected.
 *
 * Config (falls back to the read-only PG* host/port/db, with an APP_* role):
 *   APP_DATABASE_URL, or APP_PGUSER + APP_PGPASSWORD (+ optional APP_PGHOST,
 *   APP_PGPORT, APP_PGDATABASE, APP_PGSSLMODE).
 */

function firstEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.length > 0) return v;
  }
  return undefined;
}

function ssl(): "require" | false {
  const mode =
    (firstEnv("APP_PGSSLMODE", "PGSSLMODE", "DB_SSLMODE") ?? "require")
      .toLowerCase();
  return mode === "disable" ? false : "require";
}

// deno-lint-ignore no-explicit-any
function buildConfig(): any | null {
  // Include public so pg_trgm's similarity() and pgvector resolve.
  const searchPath = `corpus_ai, ${SCHEMA}, public`;
  const shared = {
    max: 4,
    idle_timeout: 20,
    prepare: firstEnv("PG_DISABLE_PREPARE") !== "1",
    ssl: ssl(),
    connection: { search_path: searchPath },
  };

  const url = firstEnv("APP_DATABASE_URL");
  if (url && !url.includes("<")) return { url, ...shared };

  const user = firstEnv("APP_PGUSER");
  const password = firstEnv("APP_PGPASSWORD");
  if (!user || !password) return null;

  return {
    ...shared,
    host: firstEnv("APP_PGHOST", "PGHOST", "DB_HOST") ?? "ssc.pm",
    port: Number(firstEnv("APP_PGPORT", "PGPORT", "DB_PORT") ?? "5433"),
    database: firstEnv("APP_PGDATABASE", "PGDATABASE", "DB_NAME") ??
      "lds_corpus",
    user,
    password,
  };
}

let _sql: postgres.Sql | null | undefined;

/** The writable connection, or null when unconfigured. Cached. */
export function getAppSql(): postgres.Sql | null {
  if (_sql !== undefined) return _sql;
  const cfg = buildConfig();
  if (!cfg) return (_sql = null);
  if ("url" in cfg && typeof cfg.url === "string") {
    const { url, ...opts } = cfg;
    _sql = postgres(url, opts);
  } else {
    _sql = postgres(cfg);
  }
  return _sql;
}

export function isAppWritableConfigured(): boolean {
  return buildConfig() !== null;
}

export async function closeAppPool(): Promise<void> {
  if (_sql) await _sql.end({ timeout: 5 });
  _sql = undefined;
}
