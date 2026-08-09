#!/usr/bin/env -S deno run -A
import "../lib/env/load.ts";
import { closePool, getSql, isDbConfigured, SCHEMA } from "../lib/db/postgres-base.ts";
import {
  getRelationColumns,
  INDEX_RELATED_LINK_CANDIDATES,
  INDEX_SEGMENT_LINK_CANDIDATES,
  resolveRelation,
  SEGMENT_VIEW_CANDIDATES,
  THEME_INDEX_CANDIDATES,
} from "../lib/db/corpus-introspect.ts";
import { resolveSegmentMap } from "../lib/db/corpus-introspect.ts";

/**
 * Print what the app can see in the corpus schema, and how it resolves the
 * logical fields it needs. Run once credentials are in .env:
 *
 *   deno task introspect
 *
 * Use the output to confirm (or, if needed, adjust) the candidate lists in
 * lib/db/corpus-introspect.ts.
 */

if (!isDbConfigured()) {
  console.error(
    "DB not configured. Set PGUSER/PGPASSWORD (read-only role) and PGHOST/PGPORT/PGDATABASE " +
      "in .env, then re-run `deno task introspect`.",
  );
  Deno.exit(1);
}

const sql = getSql();

console.log(`\n=== Schema: ${SCHEMA} ===`);
const rels = await sql<{ table_name: string; table_type: string }[]>`
  SELECT table_name, table_type
  FROM information_schema.tables
  WHERE table_schema = ${SCHEMA}
  ORDER BY table_type, table_name
`;
for (const r of rels) console.log(`  ${r.table_type.padEnd(10)} ${r.table_name}`);

async function describe(relation: string | null, label: string) {
  console.log(`\n=== ${label}: ${relation ?? "(none found)"} ===`);
  if (!relation) return;
  const cols = await getRelationColumns(relation);
  for (const c of cols ?? []) {
    console.log(`  ${c.column.padEnd(28)} ${c.dataType}${c.udtName ? ` (${c.udtName})` : ""}`);
  }
}

const segView = await resolveRelation(SEGMENT_VIEW_CANDIDATES);
await describe(segView, "Segment source view");

const themeIndex = await resolveRelation(THEME_INDEX_CANDIDATES);
await describe(themeIndex, "Theme index relation");

const segLink = await resolveRelation(INDEX_SEGMENT_LINK_CANDIDATES);
await describe(segLink, "Index→segment link");

const relLink = await resolveRelation(INDEX_RELATED_LINK_CANDIDATES);
await describe(relLink, "Index→related-index link");

console.log(`\n=== Resolved segment column map ===`);
const map = await resolveSegmentMap();
if (!map) {
  console.log("  Could not resolve a usable segment view (need at least id + text columns).");
} else {
  for (const [field, col] of Object.entries(map)) {
    console.log(`  ${field.padEnd(14)} -> ${col ?? "(unresolved)"}`);
  }
  const unresolved = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  if (unresolved.length) {
    console.log(`\n  Unresolved fields: ${unresolved.join(", ")}`);
    console.log(`  Add the real column names to the candidate lists in lib/db/corpus-introspect.ts`);
  }
}

await closePool();
console.log("\nDone.\n");
