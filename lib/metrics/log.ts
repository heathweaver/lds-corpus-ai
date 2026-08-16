import { getAppSql } from "../db/app-writable.ts";
import type { AskResult } from "../corpus/types.ts";

/**
 * Demand logging: record every research question and how well it was grounded.
 * Best-effort and optional — writes go through the WRITABLE app connection into
 * corpus_ai.query_log; when that connection isn't configured, it's a no-op, so
 * the read-only public app is unaffected. Never throws into the request path.
 */

export interface QueryLogEntry {
  question: string;
  mode: string | null;
  groundingMode: string | null;
  claimsTotal: number | null;
  claimsSupported: number | null;
  groundedness: number | null;
  segmentCount: number | null;
  indexesFollowed: string[];
  collection: string | null;
  author: string | null;
}

/** Pure mapping from an AskResult to a log row (unit-testable). */
export function queryLogEntry(question: string, r: AskResult): QueryLogEntry {
  return {
    question,
    mode: r.scope.mode,
    groundingMode: r.grounding.mode,
    claimsTotal: r.grounding.claimsTotal,
    claimsSupported: r.grounding.claimsSupported,
    groundedness: r.grounding.score,
    segmentCount: r.scope.segmentCount,
    indexesFollowed: r.scope.indexesFollowed,
    collection: r.scope.collection ?? null,
    author: r.scope.author ?? null,
  };
}

export async function logResearchQuery(
  question: string,
  r: AskResult,
): Promise<void> {
  const sql = getAppSql();
  if (!sql) return;
  const e = queryLogEntry(question, r);
  try {
    await sql`
      INSERT INTO corpus_ai.query_log
        (question, mode, grounding_mode, claims_total, claims_supported,
         groundedness, segment_count, indexes_followed, collection, author)
      VALUES (${e.question}, ${e.mode}, ${e.groundingMode}, ${e.claimsTotal},
         ${e.claimsSupported}, ${e.groundedness}, ${e.segmentCount},
         ${e.indexesFollowed}, ${e.collection}, ${e.author})
    `;
  } catch (err) {
    console.error("[metrics] query log failed:", err);
  }
}
