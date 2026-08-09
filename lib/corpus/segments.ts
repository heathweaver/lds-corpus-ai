import { getSql } from "../db/postgres-base.ts";
import { qi, resolveSegmentMap, type SegmentColumnMap } from "../db/corpus-introspect.ts";
import type { DocumentDetail, Segment, SegmentContext, SearchFilters } from "./types.ts";

/** Thrown when the corpus segment view cannot be resolved in the schema. */
export class SegmentSourceUnavailableError extends Error {
  constructor() {
    super("No segment source view (e.g. v_segment_source) found in the schema.");
    this.name = "SegmentSourceUnavailableError";
  }
}

async function requireMap(): Promise<SegmentColumnMap> {
  const map = await resolveSegmentMap();
  if (!map) throw new SegmentSourceUnavailableError();
  return map;
}

/** SELECT list that aliases resolved columns to stable output names. */
function selectList(m: SegmentColumnMap): string {
  const col = (c: string | undefined, alias: string) =>
    c ? `${qi(c)} AS ${alias}` : `NULL AS ${alias}`;
  return [
    `${qi(m.id)} AS id`,
    `${qi(m.text)} AS text`,
    col(m.documentId, "document_id"),
    col(m.documentTitle, "document_title"),
    col(m.author, "author"),
    col(m.date, "date"),
    col(m.edition, "edition"),
    col(m.sourceUrl, "source_url"),
    col(m.reference, "reference"),
    col(m.collection, "collection"),
    col(m.ordinal, "ordinal"),
  ].join(", ");
}

interface RawRow {
  id: string | number;
  text: string | null;
  document_id: string | number | null;
  document_title: string | null;
  author: string | null;
  date: string | null;
  edition: string | null;
  source_url: string | null;
  reference: string | null;
  collection: string | null;
  ordinal: number | string | null;
}

function toSegment(r: RawRow): Segment {
  return {
    id: String(r.id),
    text: r.text ?? "",
    documentId: r.document_id == null ? null : String(r.document_id),
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

/** tsvector expression for the resolved view (real column or built inline). */
function tsvExpr(m: SegmentColumnMap): string {
  return m.tsv ? qi(m.tsv) : `to_tsvector('english', coalesce(${qi(m.text)}::text, ''))`;
}

/**
 * Full-text + faceted search over the segment source view. Mirrors the
 * dynamic-WHERE builder from twiglit-notes queries.ts (`$?`→`$N` + sql.unsafe).
 * All interpolated identifiers come from introspection (validated by qi()),
 * never from user input; user values are bound as positional params.
 */
export async function searchSegments(filters: SearchFilters): Promise<Segment[]> {
  const m = await requireMap();
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
  let rankExpr = "NULL";
  if (q) {
    add(`${tsvExpr(m)} @@ websearch_to_tsquery('english', $?)`, q);
    // Reuse the same param index for ranking.
    rankExpr = `ts_rank_cd(${tsvExpr(m)}, websearch_to_tsquery('english', $${params.length}))`;
  }
  if (filters.collection && m.collection) {
    add(`${qi(m.collection)}::text ILIKE $?`, `%${filters.collection}%`);
  }
  if (filters.author && m.author) {
    add(`${qi(m.author)}::text ILIKE $?`, `%${filters.author}%`);
  }
  if (filters.dateFrom && m.date) add(`${qi(m.date)}::text >= $?`, filters.dateFrom);
  if (filters.dateTo && m.date) add(`${qi(m.date)}::text <= $?`, filters.dateTo);

  const where = conds.length ? `WHERE ${conds.join("\n  AND ")}` : "";
  const orderBy = q
    ? "ORDER BY _rank DESC NULLS LAST"
    : m.ordinal
    ? `ORDER BY ${qi(m.ordinal)} ASC`
    : "";

  const text = `
    SELECT ${selectList(m)}, ${rankExpr} AS _rank
    FROM ${qi(m.relation)}
    ${where}
    ${orderBy}
    LIMIT ${limit}
  `;
  const rows = await sql.unsafe(text, params as never[]) as unknown as RawRow[];
  return rows.map(toSegment);
}

export async function getSegmentById(id: string): Promise<Segment | null> {
  const m = await requireMap();
  const sql = getSql();
  const text = `SELECT ${selectList(m)} FROM ${qi(m.relation)} WHERE ${qi(m.id)} = $1 LIMIT 1`;
  const rows = await sql.unsafe(text, [id] as never[]) as unknown as RawRow[];
  return rows[0] ? toSegment(rows[0]) : null;
}

/**
 * A segment plus the segments immediately around it (same document, adjacent
 * ordinals). Falls back to just the segment when ordering info is unavailable.
 */
export async function getSegmentContext(id: string, window = 3): Promise<SegmentContext | null> {
  const m = await requireMap();
  const segment = await getSegmentById(id);
  if (!segment) return null;
  if (!m.documentId || !m.ordinal || segment.documentId == null || segment.ordinal == null) {
    return { segment, before: [], after: [] };
  }
  const sql = getSql();
  const text = `
    SELECT ${selectList(m)}
    FROM ${qi(m.relation)}
    WHERE ${qi(m.documentId)} = $1
      AND ${qi(m.ordinal)} BETWEEN $2 AND $3
      AND ${qi(m.id)} <> $4
    ORDER BY ${qi(m.ordinal)} ASC
  `;
  const rows = await sql.unsafe(text, [
    segment.documentId,
    segment.ordinal - window,
    segment.ordinal + window,
    id,
  ] as never[]) as unknown as RawRow[];
  const neighbors = rows.map(toSegment);
  return {
    segment,
    before: neighbors.filter((s) => (s.ordinal ?? 0) < (segment.ordinal ?? 0)),
    after: neighbors.filter((s) => (s.ordinal ?? 0) > (segment.ordinal ?? 0)),
  };
}

/** A document's metadata plus its ordered segments. */
export async function getDocument(id: string, limit = 1000): Promise<DocumentDetail | null> {
  const m = await requireMap();
  if (!m.documentId) return null;
  const sql = getSql();
  const orderBy = m.ordinal ? `ORDER BY ${qi(m.ordinal)} ASC` : "";
  const text = `
    SELECT ${selectList(m)}
    FROM ${qi(m.relation)}
    WHERE ${qi(m.documentId)} = $1
    ${orderBy}
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
