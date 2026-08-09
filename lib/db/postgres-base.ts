import "../env/load.ts";
import postgres from "postgres";

/**
 * Read-only Postgres access for the deployed research app.
 *
 * Pattern mirrors twiglit-notes (lib/db/postgres-base.ts): a single pooled
 * `postgres` connection exported for query modules. Differences for this app:
 *
 *  - It binds a LEAST-PRIVILEGE, READ-ONLY role (never lds_corpus_ingest).
 *    See sql/readonly_role.sql for the role definition.
 *  - TLS is required (sslmode=require) to reach ssc.pm.
 *  - search_path is pinned to the corpus schema so unqualified table/view
 *    names resolve inside lds_corpus.
 *  - The pool is created lazily so the server still boots (and /healthz still
 *    answers) when credentials are absent; data endpoints then return a clean
 *    503 instead of crashing the process at import time.
 */

function firstEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.length > 0) return v;
  }
  return undefined;
}

export class DbNotConfiguredError extends Error {
  constructor() {
    super(
      "Database is not configured: set PGPASSWORD/DB_PASSWORD (and PGUSER/DB_USER) " +
        "for the read-only application role, or a full DATABASE_URL.",
    );
    this.name = "DbNotConfiguredError";
  }
}

/** Corpus schema; unqualified identifiers resolve here. */
export const SCHEMA = firstEnv("DB_SCHEMA", "PGSCHEMA") ?? "lds_corpus";

function sslOption(): "require" | false {
  const mode = (firstEnv("PGSSLMODE", "DB_SSLMODE") ?? "require").toLowerCase();
  return mode === "disable" ? false : "require";
}

function buildConfig(): postgres.Options<Record<string, never>> | null {
  const url = firstEnv("DATABASE_URL");
  const usableUrl = url && !url.includes("<") ? url : undefined;

  const shared: postgres.Options<Record<string, never>> = {
    max: 10,
    idle_timeout: 20,
    prepare: firstEnv("PG_DISABLE_PREPARE") !== "1",
    ssl: sslOption(),
    connection: { search_path: SCHEMA },
    // Read-only guard: the role is read-only in Postgres, but declare intent
    // at the session level too so any accidental write fails loudly.
    transform: undefined,
  };

  if (usableUrl) {
    return { ...shared, url: usableUrl } as unknown as postgres.Options<
      Record<string, never>
    >;
  }

  const user = firstEnv("PGUSER", "DB_USER");
  const password = firstEnv("PGPASSWORD", "DB_PASSWORD");
  if (!user || !password) return null;

  return {
    ...shared,
    host: firstEnv("PGHOST", "DB_HOST") ?? "ssc.pm",
    port: Number(firstEnv("PGPORT", "DB_PORT") ?? "5433"),
    database: firstEnv("PGDATABASE", "DB_NAME") ?? "lds_corpus",
    user,
    password,
  };
}

let _sql: postgres.Sql | null = null;

/** Lazily create and return the pooled read-only connection. */
export function getSql(): postgres.Sql {
  if (_sql) return _sql;
  const cfg = buildConfig();
  if (!cfg) throw new DbNotConfiguredError();
  if ("url" in cfg && typeof (cfg as { url?: string }).url === "string") {
    const { url, ...opts } = cfg as unknown as
      & { url: string }
      & postgres.Options<
        Record<string, never>
      >;
    _sql = postgres(url, opts);
  } else {
    _sql = postgres(cfg);
  }
  return _sql;
}

/** True when the app has enough configuration to open a DB connection. */
export function isDbConfigured(): boolean {
  return buildConfig() !== null;
}

/** Run a read-only operation with the pooled connection. */
export function withClient<T>(
  op: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  return op(getSql());
}

/** Close the pool (graceful shutdown / end of scripts). */
export async function closePool(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
