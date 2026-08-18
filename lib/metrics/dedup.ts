import { getAppSql } from "../db/app-writable.ts";
import type { SimilarQuery } from "../corpus/types.ts";

/**
 * Query dedup — find previously-asked, near-duplicate questions via pg_trgm
 * similarity over the demand log. Lets a caller reuse an existing answer /
 * theme article instead of re-running expensive retrieval + verification.
 *
 * No-op (returns []) when the writable app connection / query log isn't
 * configured. Threshold defaults to 0.6, overridable via DEDUP_SIMILARITY.
 */

interface Row {
  question: string;
  sim: number;
  groundedness: number | null;
  mode: string | null;
  asked_at: string;
}

export async function findSimilarQuestions(
  question: string,
  opts?: { threshold?: number; limit?: number },
): Promise<SimilarQuery[]> {
  const sql = getAppSql();
  if (!sql) return [];
  const threshold = opts?.threshold ??
    Number(Deno.env.get("DEDUP_SIMILARITY") ?? "0.6");
  const limit = opts?.limit ?? 5;
  try {
    const rows = await sql<Row[]>`
      SELECT question,
             similarity(question, ${question}) AS sim,
             groundedness, mode, created_at::text AS asked_at
      FROM corpus_ai.query_log
      WHERE question <> ${question}
        AND similarity(question, ${question}) >= ${threshold}
      ORDER BY sim DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      question: r.question,
      similarity: Math.round(r.sim * 1000) / 1000,
      groundedness: r.groundedness,
      mode: r.mode,
      askedAt: r.asked_at,
    }));
  } catch (err) {
    console.error("[dedup] similarity lookup failed:", err);
    return [];
  }
}
