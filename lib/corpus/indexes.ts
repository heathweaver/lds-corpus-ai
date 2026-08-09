import { getSql } from "../db/postgres-base.ts";
import type { IndexNote } from "./types.ts";

/**
 * Theme-index (Zettelkasten) access over the real schema:
 *
 *   theme_index ──1:*── theme_index_version ──1:*── index_section
 *     ──1:*── index_paragraph ──1:*── support_link ──*:1── segment
 *
 * `theme_index.current_version_id` points at the live version. Source segments
 * for an index are the distinct `support_link.segment_id`s reachable from its
 * current version. "Related" indexes are other themes that cite overlapping
 * segments (there is no explicit index-to-index relation table).
 *
 * Everything degrades to empty when no theme indexes are populated, so
 * retrieval falls back to direct segment search (per the spec).
 */

let _tableExists: boolean | undefined;
async function themeIndexExists(): Promise<boolean> {
  if (_tableExists === undefined) {
    const sql = getSql();
    const [row] = await sql<{ reg: string | null }[]>`
      SELECT to_regclass('lds_corpus.theme_index')::text AS reg
    `;
    _tableExists = !!row?.reg;
  }
  return _tableExists;
}

interface RawIndexRow {
  id: string;
  title: string | null;
  note: string | null;
}

function toIndexNote(r: RawIndexRow): IndexNote {
  return { id: String(r.id), title: r.title ?? String(r.id), note: r.note };
}

/** Keyword search over theme indexes (title + thesis + question). */
export async function searchIndexes(
  q: string,
  limit = 20,
): Promise<IndexNote[]> {
  if (!(await themeIndexExists())) return [];
  const sql = getSql();
  const query = q.trim();
  const lim = Math.min(limit, 100);
  const rows = query
    ? await sql<RawIndexRow[]>`
        SELECT ti.id::text AS id, ti.title,
               COALESCE(ti.thesis, ti.investigative_question) AS note
        FROM theme_index ti
        WHERE to_tsvector('english',
                ti.title || ' ' || COALESCE(ti.thesis, '') || ' ' ||
                COALESCE(ti.investigative_question, ''))
              @@ websearch_to_tsquery('english', ${query})
           OR ti.title ILIKE ${"%" + query + "%"}
        ORDER BY ti.title ASC
        LIMIT ${lim}
      `
    : await sql<RawIndexRow[]>`
        SELECT ti.id::text AS id, ti.title,
               COALESCE(ti.thesis, ti.investigative_question) AS note
        FROM theme_index ti
        ORDER BY ti.title ASC
        LIMIT ${lim}
      `;
  return rows.map(toIndexNote);
}

/** Fetch one index with its related indexes and linked source segment ids. */
export async function getIndex(id: string): Promise<IndexNote | null> {
  if (!(await themeIndexExists())) return null;
  const sql = getSql();
  const [row] = await sql<RawIndexRow[]>`
    SELECT ti.id::text AS id, ti.title,
           COALESCE(ti.thesis, ti.investigative_question) AS note
    FROM theme_index ti
    WHERE ti.id = ${id}
    LIMIT 1
  `;
  if (!row) return null;
  const note = toIndexNote(row);
  note.segmentIds = await linkedSegmentIds(id);
  note.related = await relatedIndexes(id);
  return note;
}

/** Distinct source segment ids an index's current version points toward. */
export async function linkedSegmentIds(indexId: string): Promise<string[]> {
  if (!(await themeIndexExists())) return [];
  const sql = getSql();
  const rows = await sql<{ segment_id: string }[]>`
    SELECT DISTINCT sl.segment_id::text AS segment_id
    FROM theme_index ti
    JOIN theme_index_version tiv
      ON tiv.id = COALESCE(
           ti.current_version_id,
           (SELECT id FROM theme_index_version
             WHERE theme_index_id = ti.id ORDER BY version DESC LIMIT 1))
    JOIN index_section sec ON sec.theme_index_version_id = tiv.id
    JOIN index_paragraph ip ON ip.index_section_id = sec.id
    JOIN support_link sl ON sl.index_paragraph_id = ip.id
    WHERE ti.id = ${indexId}
    LIMIT 500
  `;
  return rows.map((r) => r.segment_id);
}

/** Other themes that cite overlapping segments, most-shared first. */
async function relatedIndexes(
  indexId: string,
): Promise<{ id: string; title: string }[]> {
  const sql = getSql();
  const rows = await sql<{ id: string; title: string; shared: number }[]>`
    WITH mine AS (
      SELECT DISTINCT sl.segment_id
      FROM theme_index_version tiv
      JOIN index_section sec ON sec.theme_index_version_id = tiv.id
      JOIN index_paragraph ip ON ip.index_section_id = sec.id
      JOIN support_link sl ON sl.index_paragraph_id = ip.id
      WHERE tiv.theme_index_id = ${indexId}
    )
    SELECT ti2.id::text AS id, ti2.title, COUNT(DISTINCT sl2.segment_id)::int AS shared
    FROM support_link sl2
    JOIN mine ON mine.segment_id = sl2.segment_id
    JOIN index_paragraph ip2 ON ip2.id = sl2.index_paragraph_id
    JOIN index_section sec2 ON sec2.id = ip2.index_section_id
    JOIN theme_index_version tiv2 ON tiv2.id = sec2.theme_index_version_id
    JOIN theme_index ti2 ON ti2.id = tiv2.theme_index_id
    WHERE ti2.id <> ${indexId}
    GROUP BY ti2.id, ti2.title
    ORDER BY shared DESC, ti2.title ASC
    LIMIT 8
  `;
  return rows.map((r) => ({
    id: String(r.id),
    title: r.title ?? String(r.id),
  }));
}

/** Whether theme indexes exist and are usable. */
export async function indexesAvailable(): Promise<boolean> {
  return await themeIndexExists();
}
