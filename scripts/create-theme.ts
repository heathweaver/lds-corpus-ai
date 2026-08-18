#!/usr/bin/env -S deno run -A
import "../lib/env/load.ts";
import { parseArgs } from "@std/cli/parse-args";
import { anthropicClient, llmAvailable } from "../lib/grounding/llm.ts";
import { closePool } from "../lib/db/postgres-base.ts";
import { createTheme } from "../lib/themes/create.ts";

/**
 * Generate a grounded theme index from the corpus.
 *
 *   deno task theme -- --title "Faith and Belief" \
 *     --question "How is faith described as a principle of action?" \
 *     --collection "Book of Mormon" --persist
 *
 * Without --persist it's a dry run (prints the verified plan, writes nothing).
 * Requires ANTHROPIC_API_KEY (generation + verification) and DB credentials.
 */

const args = parseArgs(Deno.args, {
  string: ["title", "question", "slug", "collection", "author", "max"],
  boolean: ["persist"],
});

if (!args.title) {
  console.error(
    'Usage: deno task theme -- --title "..." [--question "..."] ' +
      "[--collection ..] [--author ..] [--slug ..] [--max 24] [--persist]",
  );
  Deno.exit(1);
}
if (!llmAvailable()) {
  console.error("ANTHROPIC_API_KEY is required (generation + verification).");
  Deno.exit(1);
}

const result = await createTheme(
  {
    title: args.title,
    question: args.question,
    slug: args.slug,
    scope: { collection: args.collection, author: args.author },
    maxSegments: args.max ? parseInt(args.max, 10) : undefined,
    persist: !!args.persist,
  },
  anthropicClient(),
);

console.log(
  `\n# ${result.title}${
    result.persisted ? "  (persisted, draft)" : "  (dry run)"
  }`,
);
console.log(
  `slug: ${result.slug}${result.themeId ? `  id: ${result.themeId}` : ""}`,
);
console.log(`\nThesis: ${result.thesis}\n`);
for (const s of result.sections) {
  console.log(`## ${s.heading}`);
  for (const p of s.paragraphs) {
    console.log(`  ${p.text}`);
    for (const sup of p.supports) {
      console.log(
        `    ↳ [${sup.status} ${
          sup.confidence.toFixed(2)
        }] seg ${sup.segmentId} “${sup.quote.slice(0, 60)}”`,
      );
    }
  }
}
if (result.droppedParagraphs.length > 0) {
  console.log(
    `\n⚠ Dropped ${result.droppedParagraphs.length} unsupported paragraph(s):`,
  );
  for (const d of result.droppedParagraphs) {
    console.log(`  - (${d.reason}) ${d.text.slice(0, 80)}…`);
  }
}
console.log(
  `\nStats: ${result.stats.candidateSegments} candidates, ` +
    `${result.stats.paragraphsKept}/${result.stats.paragraphsTotal} paragraphs kept, ` +
    `${result.stats.supportLinksVerified} verified support links.`,
);

await closePool();
