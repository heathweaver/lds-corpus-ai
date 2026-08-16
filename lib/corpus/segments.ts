import { getSql } from "../db/postgres-base.ts";
import type {
  DocumentDetail,
  SearchFilters,
  Segment,
  SegmentContext,
} from "./types.ts";

/**
 * Segment access over `lds_corpus.v_segment_source` (the spec's sanctioned
 * search surface), enriched with columns the view doesn't expose:
 *  - author  ← contribution → agent.preferred_name (LATERAL)
 *  - edition ← document.edition_label
 *  - source_url ← first entry of the view's `sources` jsonb
 *  - ordinal ← content_node.sequence (reading order)
 * Full-text search uses the indexed `segment.search_vector` tsvector.
 *
 * search_path is pinned to lds_corpus (see postgres-base.ts), so relation
 * names are unqualified. SQL is static with positional params — no dynamic
 * identifiers.
 */

/** Thrown when the corpus segment view is absent from the schema. */
export class SegmentSourceUnavailableError extends Error {
  constructor() {
    super(
      "No segment source view (lds_corpus.v_segment_source) found in the schema.",
    );
    this.name = "SegmentSourceUnavailableError";
  }
}

let _viewExists: boolean | undefined;
async function requireView(): Promise<void> {
  if (_viewExists === undefined) {
    const sql = getSql();
    const [row] = await sql<{ reg: string | null }[]>`
      SELECT to_regclass('lds_corpus.v_segment_source')::text AS reg
    `;
    _viewExists = !!row?.reg;
  }
  if (!_viewExists) throw new SegmentSourceUnavailableError();
}

// Shared projection + enrichment joins. `vs` is the segment source row.
export const SEGMENT_SELECT = `
  vs.segment_id::text          AS id,
  vs.text                      AS text,
  vs.document_id::text         AS document_id,
  vs.document_title            AS document_title,
  au.author                    AS author,
  vs.publication_start::text   AS date,
  d.edition_label              AS edition,
  (vs.sources -> 0 ->> 'source_url') AS source_url,
  vs.segment_key               AS reference,
  vs.work_title                AS collection,
  ord.seq::float8              AS ordinal
`;

export const SEGMENT_JOINS = `
  JOIN document d ON d.id = vs.document_id
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT a.preferred_name, ', ') AS author
    FROM contribution c
    JOIN agent a ON a.id = c.agent_id
    WHERE c.document_id = vs.document_id
  ) au ON true
  LEFT JOIN LATERAL (
    SELECT min(cn.sequence) AS seq
    FROM segment_node sn
    JOIN content_node cn ON cn.id = sn.content_node_id
    WHERE sn.segment_id = vs.segment_id
  ) ord ON true
`;

export interface RawRow {
  id: string;
  text: string | null;
  document_id: string | null;
  document_title: string | null;
  author: string | null;
  date: string | null;
  edition: string | null;
  source_url: string | null;
  reference: string | null;
  collection: string | null;
  ordinal: number | null;
}

export function toSegment(r: RawRow): Segment {
  return {
    id: String(r.id),
    text: r.text ?? "",
    documentId: r.document_id,
    documentTitle: r.document_title,
    author: r.author,
    date: r.date,
    edition: r.edition,
    sourceUrl: r.source_url,
    reference: r.reference,
    collection: r.collection,
    ordinal: r.ordinal == null ? null : Number(r.ordinal),
  };
}

/**
 * Full-text + faceted search. Mirrors the dynamic-WHERE builder from
 * twiglit-notes queries.ts (`$?`→`$N` + sql.unsafe). Uses the indexed
 * segment.search_vector for FTS and ts_rank_cd for ranking.
 */
export async function searchSegments(
  filters: SearchFilters,
): Promise<Segment[]> {
  await requireView();
  const sql = getSql();
  const limit = Math.min(filters.limit ?? 50, 200);

  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, ...vals: unknown[]) => {
    let i = 0;
    conds.push(cond.replace(/\$\?/g, () => `$${params.length + ++i}`));
    for (const v of vals) params.push(v);
  };

  const q = filters.q?.trim();
  const needSegmentJoin = !!q;
  let rank = "NULL";
  if (q) {
    add(`s.search_vector @@ websearch_to_tsquery('english', $?)`, q);
    rank =
      `ts_rank_cd(s.search_vector, websearch_to_tsquery('english', $${params.length}))`;
  }
  if (filters.collection) {
    add(`vs.work_title ILIKE $?`, `%${filters.collection}%`);
  }
  if (filters.author) add(`au.author ILIKE $?`, `%${filters.author}%`);
  if (filters.dateFrom) {
    add(`vs.publication_start >= $?::date`, filters.dateFrom);
  }
  if (filters.dateTo) add(`vs.publication_start <= $?::date`, filters.dateTo);

  const where = conds.length ? `WHERE ${conds.join("\n  AND ")}` : "";
  const orderBy = q
    ? "ORDER BY _rank DESC NULLS LAST"
    : "ORDER BY ord.seq ASC NULLS LAST, vs.segment_key ASC";
  const segmentJoin = needSegmentJoin
    ? "JOIN segment s ON s.id = vs.segment_id"
    : "";

  const text = `
    SELECT ${SEGMENT_SELECT}, ${rank} AS _rank
    FROM v_segment_source vs
    ${segmentJoin}
    ${SEGMENT_JOINS}
    ${where}
    ${orderBy}
    LIMIT ${limit}
  `;
  const rows = await sql.unsafe(text, params as never[]) as unknown as RawRow[];
  return rows.map(toSegment);
}

export async function getSegmentById(id: string): Promise<Segment | null> {
  await requireView();
  const sql = getSql();
  const text = `
    SELECT ${SEGMENT_SELECT}
    FROM v_segment_source vs
    ${SEGMENT_JOINS}
    WHERE vs.segment_id = $1
    LIMIT 1
  `;
  const rows = await sql.unsafe(text, [id] as never[]) as unknown as RawRow[];
  return rows[0] ? toSegment(rows[0]) : null;
}

/**
 * A segment plus the segments immediately around it, following the
 * segment.previous_segment_id / next_segment_id reading-order chain (exact,
 * cheap — 2·window rows).
 */
export async function getSegmentContext(
  id: string,
  window = 3,
): Promise<SegmentContext | null> {
  await requireView();
  const segment = await getSegmentById(id);
  if (!segment) return null;
  const sql = getSql();
  const text = `
    WITH RECURSIVE back AS (
      SELECT id, previous_segment_id, 0 AS dist FROM segment WHERE id = $1
      UNION ALL
      SELECT s.id, s.previous_segment_id, back.dist + 1
      FROM segment s JOIN back ON s.id = back.previous_segment_id
      WHERE back.dist < $2
    ),
    fwd AS (
      SELECT id, next_segment_id, 0 AS dist FROM segment WHERE id = $1
      UNION ALL
      SELECT s.id, s.next_segment_id, fwd.dist + 1
      FROM segment s JOIN fwd ON s.id = fwd.next_segment_id
      WHERE fwd.dist < $2
    ),
    nbr AS (
      SELECT id, -dist AS pos FROM back WHERE dist > 0
      UNION
      SELECT id, dist AS pos FROM fwd WHERE dist > 0
    )
    SELECT ${SEGMENT_SELECT}, nbr.pos AS _pos
    FROM nbr
    JOIN v_segment_source vs ON vs.segment_id = nbr.id
    ${SEGMENT_JOINS}
    ORDER BY nbr.pos ASC
  `;
  const rows = await sql.unsafe(text, [id, window] as never[]) as unknown as
    & RawRow[]
    & { _pos: number }[];
  const before: Segment[] = [];
  const after: Segment[] = [];
  for (const r of rows) {
    const pos = (r as unknown as { _pos: number })._pos;
    (pos < 0 ? before : after).push(toSegment(r));
  }
  return { segment, before, after };
}

/** A document's metadata plus its ordered segments. */
export async function getDocument(
  id: string,
  limit = 1000,
): Promise<DocumentDetail | null> {
  await requireView();
  const sql = getSql();
  const text = `
    SELECT ${SEGMENT_SELECT}
    FROM v_segment_source vs
    ${SEGMENT_JOINS}
    WHERE vs.document_id = $1
    ORDER BY ord.seq ASC NULLS LAST, vs.segment_key ASC
    LIMIT ${Math.min(limit, 5000)}
  `;
  const rows = await sql.unsafe(text, [id] as never[]) as unknown as RawRow[];
  if (rows.length === 0) return null;
  const segments = rows.map(toSegment);
  const head = segments[0];
  return {
    id,
    title: head.documentTitle,
    author: head.author,
    date: head.date,
    edition: head.edition,
    collection: head.collection,
    sourceUrl: head.sourceUrl,
    segments,
  };
}
