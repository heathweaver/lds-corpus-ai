import { getSql } from "../db/postgres-base.ts";
import {
  getRelationColumns,
  INDEX_RELATED_LINK_CANDIDATES,
  INDEX_SEGMENT_LINK_CANDIDATES,
  pickColumn,
  qi,
  resolveRelation,
  THEME_INDEX_CANDIDATES,
} from "../db/corpus-introspect.ts";
import type { IndexNote } from "./types.ts";

/**
 * Theme-index (Zettelkasten) access. The spec notes indexes may not be
 * populated yet — every function degrades to empty when the relations are
 * absent, so retrieval can fall back to direct segment search.
 */

interface IndexMap {
  relation: string;
  id: string;
  title: string;
  note?: string;
}

let indexMapCache: IndexMap | null | undefined;

async function resolveIndexMap(): Promise<IndexMap | null> {
  if (indexMapCache !== undefined) return indexMapCache;
  const relation = await resolveRelation(THEME_INDEX_CANDIDATES);
  if (!relation) return (indexMapCache = null);
  const cols = (await getRelationColumns(relation))!;
  const id = pickColumn(cols, ["index_id", "id", "theme_id", "slug"]);
  const title = pickColumn(cols, [
    "title",
    "name",
    "label",
    "theme",
    "heading",
  ]);
  if (!id || !title) return (indexMapCache = null);
  return (indexMapCache = {
    relation,
    id,
    title,
    note: pickColumn(cols, [
      "note",
      "description",
      "summary",
      "body",
      "notes",
      "gloss",
    ]),
  });
}

/** Whether theme indexes exist and are usable. */
export async function indexesAvailable(): Promise<boolean> {
  return (await resolveIndexMap()) !== null;
}

function selectList(m: IndexMap): string {
  return [
    `${qi(m.id)} AS id`,
    `${qi(m.title)} AS title`,
    m.note ? `${qi(m.note)} AS note` : `NULL AS note`,
  ].join(", ");
}

interface RawIndexRow {
  id: string | number;
  title: string | null;
  note: string | null;
}

function toIndexNote(r: RawIndexRow): IndexNote {
  return { id: String(r.id), title: r.title ?? String(r.id), note: r.note };
}

/** Keyword search over theme indexes (title + note). Empty when none exist. */
export async function searchIndexes(
  q: string,
  limit = 20,
): Promise<IndexNote[]> {
  const m = await resolveIndexMap();
  if (!m) return [];
  const sql = getSql();
  const query = q.trim();
  const params: unknown[] = [];
  let where = "";
  if (query) {
    const noteExpr = m.note ? `coalesce(${qi(m.note)}::text, '')` : "''";
    const tsv = `to_tsvector('english', ${
      qi(m.title)
    }::text || ' ' || ${noteExpr})`;
    where = `WHERE ${tsv} @@ websearch_to_tsquery('english', $1)
      OR ${qi(m.title)}::text ILIKE $2`;
    params.push(query, `%${query}%`);
  }
  const text = `
    SELECT ${selectList(m)}
    FROM ${qi(m.relation)}
    ${where}
    ORDER BY ${qi(m.title)} ASC
    LIMIT ${Math.min(limit, 100)}
  `;
  const rows = await sql.unsafe(
    text,
    params as never[],
  ) as unknown as RawIndexRow[];
  return rows.map(toIndexNote);
}

/** Fetch one index with its related indexes and linked source segment ids. */
export async function getIndex(id: string): Promise<IndexNote | null> {
  const m = await resolveIndexMap();
  if (!m) return null;
  const sql = getSql();
  const rows = await sql.unsafe(
    `SELECT ${selectList(m)} FROM ${qi(m.relation)} WHERE ${
      qi(m.id)
    } = $1 LIMIT 1`,
    [id] as never[],
  ) as unknown as RawIndexRow[];
  if (!rows[0]) return null;
  const note = toIndexNote(rows[0]);
  note.segmentIds = await linkedSegmentIds(id);
  note.related = await relatedIndexes(m, id);
  return note;
}

/** Source segment ids an index points toward (empty if no link table). */
export async function linkedSegmentIds(indexId: string): Promise<string[]> {
  const relation = await resolveRelation(INDEX_SEGMENT_LINK_CANDIDATES);
  if (!relation) return [];
  const cols = (await getRelationColumns(relation))!;
  const idxCol = pickColumn(cols, [
    "index_id",
    "theme_id",
    "theme_index_id",
    "index",
  ]);
  const segCol = pickColumn(cols, [
    "segment_id",
    "seg_id",
    "source_segment_id",
    "node_id",
  ]);
  if (!idxCol || !segCol) return [];
  const sql = getSql();
  const rows = await sql.unsafe(
    `SELECT ${qi(segCol)} AS seg FROM ${qi(relation)} WHERE ${qi(idxCol)} = $1`,
    [indexId] as never[],
  ) as unknown as { seg: string | number }[];
  return rows.map((r) => String(r.seg));
}

async function relatedIndexes(
  m: IndexMap,
  indexId: string,
): Promise<{ id: string; title: string }[]> {
  const relation = await resolveRelation(INDEX_RELATED_LINK_CANDIDATES);
  if (!relation) return [];
  const cols = (await getRelationColumns(relation))!;
  const fromCol = pickColumn(cols, [
    "index_id",
    "from_index_id",
    "source_index_id",
    "from_id",
  ]);
  const toCol = pickColumn(cols, [
    "related_index_id",
    "to_index_id",
    "target_index_id",
    "to_id",
  ]);
  if (!fromCol || !toCol) return [];
  const sql = getSql();
  const rows = await sql.unsafe(
    `SELECT r.${qi(toCol)} AS id, i.${qi(m.title)} AS title
     FROM ${qi(relation)} r
     JOIN ${qi(m.relation)} i ON i.${qi(m.id)} = r.${qi(toCol)}
     WHERE r.${qi(fromCol)} = $1
     ORDER BY title ASC`,
    [indexId] as never[],
  ) as unknown as { id: string | number; title: string | null }[];
  return rows.map((r) => ({
    id: String(r.id),
    title: r.title ?? String(r.id),
  }));
}
