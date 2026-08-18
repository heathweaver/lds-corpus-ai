import { getSql, SCHEMA } from "./postgres-base.ts";

/**
 * Runtime schema resolution for the corpus.
 *
 * The exact column and table names inside `lds_corpus` are owned by the
 * ingest pipeline, not this app. Rather than hard-code guesses, we resolve
 * them once at runtime against `information_schema` and map each logical field
 * (id, text, author, …) to whichever real column exists, by candidate list.
 *
 * This keeps the app correct across small schema variations and makes
 * finalizing trivial: run `deno task introspect` to see the real names, then
 * (only if needed) adjust the candidate lists below.
 */

export interface ColumnInfo {
  column: string;
  dataType: string;
  udtName: string;
}

const relationCache = new Map<string, ColumnInfo[] | null>();

/** Columns of a table/view in the corpus schema (null if it doesn't exist). */
export async function getRelationColumns(
  relation: string,
): Promise<ColumnInfo[] | null> {
  if (relationCache.has(relation)) return relationCache.get(relation)!;
  const sql = getSql();
  const rows = await sql<
    { column_name: string; data_type: string; udt_name: string }[]
  >`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = ${SCHEMA} AND table_name = ${relation}
    ORDER BY ordinal_position
  `;
  const cols: ColumnInfo[] | null = rows.length === 0
    ? null
    : rows.map((r) => ({
      column: r.column_name,
      dataType: r.data_type,
      udtName: r.udt_name,
    }));
  relationCache.set(relation, cols);
  return cols;
}

/** First relation in `candidates` that exists in the corpus schema. */
export async function resolveRelation(
  candidates: string[],
): Promise<string | null> {
  for (const name of candidates) {
    if (await getRelationColumns(name)) return name;
  }
  return null;
}

/** Pick the first candidate column present in `cols` (case-insensitive exact). */
export function pickColumn(
  cols: ColumnInfo[],
  candidates: string[],
): string | undefined {
  const byLower = new Map(cols.map((c) => [c.column.toLowerCase(), c.column]));
  for (const cand of candidates) {
    const hit = byLower.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/** First tsvector-typed column in `cols`, if any. */
export function pickTsVector(cols: ColumnInfo[]): string | undefined {
  return cols.find((c) => c.udtName === "tsvector")?.column;
}

// --- Candidate lists (adjust here after `deno task introspect`) -------------

/** The primary searchable view named in the spec. */
export const SEGMENT_VIEW_CANDIDATES = [
  "v_segment_source",
  "segment_source",
  "v_segments",
  "retrieval_segments",
  "segments",
];

export const THEME_INDEX_CANDIDATES = [
  "v_theme_index",
  "theme_indexes",
  "theme_index",
  "v_index",
  "indexes",
  "index_notes",
];

/** Link table: theme index -> source segment. */
export const INDEX_SEGMENT_LINK_CANDIDATES = [
  "v_theme_index_segment",
  "theme_index_segment",
  "theme_index_segments",
  "index_segment",
  "index_segments",
  "theme_index_source",
];

/** Link table: theme index -> related theme index. */
export const INDEX_RELATED_LINK_CANDIDATES = [
  "theme_index_link",
  "theme_index_related",
  "index_link",
  "related_index",
];

export interface SegmentColumnMap {
  relation: string;
  id: string;
  text: string;
  tsv?: string;
  documentId?: string;
  documentTitle?: string;
  author?: string;
  date?: string;
  edition?: string;
  sourceUrl?: string;
  reference?: string;
  collection?: string;
  ordinal?: string;
}

let segmentMapCache: SegmentColumnMap | null | undefined;

/**
 * Resolve the segment view and its logical columns. Returns null when no
 * candidate view exists (surfaced by callers as an empty result / 503).
 */
export async function resolveSegmentMap(): Promise<SegmentColumnMap | null> {
  if (segmentMapCache !== undefined) return segmentMapCache;
  const relation = await resolveRelation(SEGMENT_VIEW_CANDIDATES);
  if (!relation) {
    segmentMapCache = null;
    return null;
  }
  const cols = (await getRelationColumns(relation))!;
  const id = pickColumn(cols, [
    "segment_id",
    "id",
    "seg_id",
    "retrieval_segment_id",
    "node_id",
  ]);
  const text = pickColumn(cols, [
    "text",
    "content",
    "body",
    "segment_text",
    "plain_text",
    "content_text",
    "passage",
    "snippet",
  ]);
  if (!id || !text) {
    // Without at least an id and a text column the view is unusable.
    segmentMapCache = null;
    return null;
  }
  segmentMapCache = {
    relation,
    id,
    text,
    tsv: pickTsVector(cols),
    documentId: pickColumn(cols, [
      "document_id",
      "doc_id",
      "document",
      "source_document_id",
    ]),
    documentTitle: pickColumn(cols, [
      "document_title",
      "doc_title",
      "title",
      "source_title",
      "work_title",
    ]),
    author: pickColumn(cols, [
      "author",
      "author_name",
      "authors",
      "contributor",
      "creator",
    ]),
    date: pickColumn(cols, [
      "publication_start",
      "date",
      "pub_date",
      "published_at",
      "work_date",
      "doc_date",
      "edition_date",
      "year",
    ]),
    edition: pickColumn(cols, [
      "edition",
      "edition_name",
      "edition_label",
      "version",
    ]),
    sourceUrl: pickColumn(cols, [
      "source_url",
      "url",
      "href",
      "link",
      "source_link",
      "provenance_url",
    ]),
    reference: pickColumn(cols, [
      "segment_key",
      "reference",
      "ref",
      "citation",
      "locator",
      "canonical_ref",
      "chapter_verse",
      "label",
    ]),
    collection: pickColumn(cols, [
      "collection",
      "work",
      "work_title",
      "work_name",
      "corpus",
      "volume",
      "series",
    ]),
    ordinal: pickColumn(cols, [
      "ordinal",
      "position",
      "seq",
      "sequence",
      "sort_order",
      "segment_index",
      "node_order",
      "idx",
    ]),
  };
  return segmentMapCache;
}

/** Test-only / reload hook: clear resolution caches. */
export function _clearCorpusCaches(): void {
  relationCache.clear();
  segmentMapCache = undefined;
}

/** Validate an introspected identifier and return it double-quoted for SQL. */
export function qi(identifier: string): string {
  if (!/^[a-z_][a-z0-9_$]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
