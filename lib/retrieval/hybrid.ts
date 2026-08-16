import { getSql } from "../db/postgres-base.ts";
import {
  RawRow,
  searchSegments,
  SEGMENT_JOINS,
  SEGMENT_SELECT,
  toSegment,
} from "../corpus/segments.ts";
import type { SearchFilters, Segment } from "../corpus/types.ts";
import {
  discoverCorpusEmbedding,
  getEmbedProvider,
} from "../embed/provider.ts";

/**
 * Hybrid retrieval: keyword FTS fused with semantic vector search via
 * Reciprocal Rank Fusion (RRF). When no embedding provider is configured (or
 * the corpus has no embeddings), it transparently returns keyword results —
 * so callers can always use hybridSearch and get the best available ranking.
 */

const RRF_K = 60;

/** Fuse ranked id-lists via RRF; returns ids best-first. */
export function rrfFuse(lists: string[][], k = RRF_K): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Nearest-neighbour segment search over the corpus embeddings. */
export async function vectorSearchSegments(
  queryVec: number[],
  model: string,
  filters: SearchFilters,
  limit: number,
): Promise<Segment[]> {
  const sql = getSql();
  const params: unknown[] = [toVectorLiteral(queryVec), model];
  const conds: string[] = ["e.object_type = 'segment'", "e.model = $2"];
  const add = (cond: string, val: unknown) => {
    params.push(val);
    conds.push(cond.replace("$?", `$${params.length}`));
  };
  if (filters.collection) {
    add("vs.work_title ILIKE $?", `%${filters.collection}%`);
  }
  if (filters.author) add("au.author ILIKE $?", `%${filters.author}%`);
  if (filters.dateFrom) {
    add("vs.publication_start >= $?::date", filters.dateFrom);
  }
  if (filters.dateTo) add("vs.publication_start <= $?::date", filters.dateTo);

  const text = `
    SELECT ${SEGMENT_SELECT}, (e.embedding <=> $1::vector) AS _dist
    FROM embedding e
    JOIN v_segment_source vs ON vs.segment_id = e.object_id
    ${SEGMENT_JOINS}
    WHERE ${conds.join("\n  AND ")}
    ORDER BY e.embedding <=> $1::vector
    LIMIT ${Math.min(limit, 200)}
  `;
  const rows = await sql.unsafe(text, params as never[]) as unknown as RawRow[];
  return rows.map(toSegment);
}

/**
 * Best-available ranked segments for a query. FTS + (when configured) semantic,
 * fused by RRF. `q` empty → falls back to plain filtered search.
 */
export async function hybridSearch(
  q: string,
  filters: SearchFilters = {},
  limit = 24,
): Promise<Segment[]> {
  const query = q.trim();
  if (!query) return searchSegments({ ...filters, limit });

  const pool = Math.max(limit * 2, limit);
  const fts = await searchSegments({ ...filters, q: query, limit: pool });

  const provider = getEmbedProvider();
  if (!provider) return fts.slice(0, limit);

  try {
    const sql = getSql();
    const corpus = await discoverCorpusEmbedding(sql);
    // Only compare vectors from the same model the corpus was embedded with.
    if (!corpus || corpus.model !== provider.model) return fts.slice(0, limit);
    const [vec] = await provider.embed([query]);
    if (!vec || vec.length !== corpus.dimensions) return fts.slice(0, limit);

    const vector = await vectorSearchSegments(vec, corpus.model, filters, pool);

    // Fuse and re-materialize segments in fused order.
    const byId = new Map<string, Segment>();
    for (const s of [...fts, ...vector]) byId.set(s.id, s);
    const order = rrfFuse([fts.map((s) => s.id), vector.map((s) => s.id)]);
    return order.map((id) => byId.get(id)!).filter(Boolean).slice(0, limit);
  } catch (err) {
    // Semantic search is an enhancement; never fail the request over it.
    console.error("Vector search failed, using keyword results:", err);
    return fts.slice(0, limit);
  }
}
