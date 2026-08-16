import type { Anthropic } from "@anthropic-ai/sdk";
import type postgres from "postgres";
import { getSql } from "../db/postgres-base.ts";
import type { LlmClient } from "../grounding/llm.ts";
import {
  isAccepted,
  supportStrength,
  verifyEntailment,
} from "../grounding/verify.ts";
import { searchSegments } from "../corpus/segments.ts";
import type { Segment } from "../corpus/types.ts";

/**
 * Grounded theme-index creation.
 *
 *   retrieve candidates → GENERATE sections/paragraphs (each a claim citing
 *   segment numbers) → VERIFY every paragraph against its cited segments →
 *   keep ONLY paragraphs with ≥1 verified support → persist as
 *   theme_index / version / section / paragraph / support_link.
 *
 * Anti-fabrication guarantees:
 *  - A paragraph that no cited source supports is DROPPED, never persisted.
 *  - Every persisted support_link carries verifier_status='verified' and a
 *    support_strength derived from the independent verifier — the writer model
 *    cannot vouch for itself.
 *  - The theme is written status='draft', version review_status='generated':
 *    generation never auto-publishes; a human promotes it.
 */

export interface CreateThemeInput {
  title: string;
  /** The investigative question the theme explores. */
  question?: string;
  slug?: string;
  scope?: { collection?: string; author?: string };
  /** Candidate segments to ground on (default 24). */
  maxSegments?: number;
  /** Write to the DB. Default false — dry run returns the plan only. */
  persist?: boolean;
  minConfidence?: number;
  /** Pre-supplied candidate segments (skips retrieval; used by tests). */
  candidates?: Segment[];
}

export interface SupportResult {
  segmentId: string;
  quote: string;
  status: "supported" | "partial";
  confidence: number;
  sourceStart: number | null;
  sourceEnd: number | null;
}

export interface ParagraphResult {
  text: string;
  supports: SupportResult[];
}

export interface SectionResult {
  heading: string;
  paragraphs: ParagraphResult[];
}

export interface DroppedParagraph {
  heading: string;
  text: string;
  reason: string;
}

export interface CreateThemeResult {
  slug: string;
  title: string;
  thesis: string;
  themeId?: string;
  versionId?: string;
  persisted: boolean;
  sections: SectionResult[];
  droppedParagraphs: DroppedParagraph[];
  stats: {
    candidateSegments: number;
    paragraphsTotal: number;
    paragraphsKept: number;
    supportLinksVerified: number;
  };
}

const SYSTEM =
  `You are building a Zettelkasten-style THEME INDEX over a corpus of ` +
  `Latter-day Saint scripture and early LDS history. You are given numbered ` +
  `source segments. Write a short thesis and 2–5 sections; each section has ` +
  `1–3 short paragraphs. Every paragraph must make only claims that the cited ` +
  `segments directly support, and must list the segment numbers it relies on. ` +
  `Never write a sentence you cannot tie to a listed segment. Do not speculate, ` +
  `harmonize, or add received interpretation. If the segments are thin, write ` +
  `less. Prefer close paraphrase of what the sources actually say.`;

const TOOL: Anthropic.Tool = {
  name: "draft_theme",
  description: "Draft a grounded theme index from the provided segments.",
  input_schema: {
    type: "object",
    properties: {
      thesis: {
        type: "string",
        description: "One or two sentences; the theme's claim.",
      },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            paragraphs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description: "A short claim-bearing paragraph.",
                  },
                  cited_segments: {
                    type: "array",
                    items: { type: "integer" },
                    description:
                      "1-based segment numbers supporting this paragraph.",
                  },
                },
                required: ["text", "cited_segments"],
                additionalProperties: false,
              },
            },
          },
          required: ["heading", "paragraphs"],
          additionalProperties: false,
        },
      },
    },
    required: ["thesis", "sections"],
    additionalProperties: false,
  },
};

interface RawTheme {
  thesis: string;
  sections: {
    heading: string;
    paragraphs: { text: string; cited_segments: number[] }[];
  }[];
}

const SEGMENT_CHAR_CAP = 1500;

function renderSegments(segments: Segment[]): string {
  return segments
    .map((s, i) => {
      const label = [s.documentTitle, s.reference].filter(Boolean).join(", ");
      return `[${i + 1}] (${label})\n${s.text.slice(0, SEGMENT_CHAR_CAP)}`;
    })
    .join("\n\n");
}

function slugify(s: string, fallback: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return /^[a-z0-9]/.test(out) ? out : fallback;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Locate a verbatim quote within a source; return [start,end) or [null,null]. */
function quoteOffsets(
  source: string,
  quote: string,
): [number | null, number | null] {
  if (!quote) return [null, null];
  const idx = source.toLowerCase().indexOf(quote.toLowerCase());
  if (idx < 0) return [null, null];
  return [idx, idx + quote.length];
}

/**
 * Run the full generate → verify → (persist) pipeline. `llm` and `sql` are
 * injectable for testing.
 */
export async function createTheme(
  input: CreateThemeInput,
  llm: LlmClient,
  sql?: postgres.Sql,
): Promise<CreateThemeResult> {
  const maxSegments = input.maxSegments ?? 24;
  const minConfidence = input.minConfidence ?? 0.6;

  // 1) Candidate retrieval (keyword FTS; hybrid/semantic can slot in here).
  const query = [input.title, input.question].filter(Boolean).join(" ");
  const segments = input.candidates ?? await searchSegments({
    q: query,
    collection: input.scope?.collection,
    author: input.scope?.author,
    limit: maxSegments,
  });

  const slug = input.slug
    ? slugify(input.slug, "theme")
    : slugify(input.title, "theme");
  const empty: CreateThemeResult = {
    slug,
    title: input.title,
    thesis: "",
    persisted: false,
    sections: [],
    droppedParagraphs: [],
    stats: {
      candidateSegments: segments.length,
      paragraphsTotal: 0,
      paragraphsKept: 0,
      supportLinksVerified: 0,
    },
  };
  if (segments.length === 0) return empty;

  // 2) Generate a structured draft (writer model).
  const draft = await llm.toolCall<RawTheme>({
    system: SYSTEM,
    cacheSystem: true,
    maxTokens: 2000,
    tool: TOOL,
    user: `Theme title: ${input.title}\n` +
      (input.question ? `Investigative question: ${input.question}\n` : "") +
      `\nSource segments:\n\n${renderSegments(segments)}`,
  });

  // 3) Verify every paragraph against its cited segments (independent pass).
  const keptSections: SectionResult[] = [];
  const dropped: DroppedParagraph[] = [];
  let paragraphsTotal = 0;
  let linksVerified = 0;

  for (const section of draft.sections ?? []) {
    const keptParas: ParagraphResult[] = [];
    for (const para of section.paragraphs ?? []) {
      const text = para.text?.trim();
      if (!text) continue;
      paragraphsTotal++;
      const cited = (para.cited_segments ?? [])
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= segments.length)
        .map((n) => segments[n - 1]);

      const supports: SupportResult[] = [];
      for (const seg of cited) {
        const v = await verifyEntailment(llm, text, seg.text);
        if (isAccepted(v, minConfidence) && v.status !== "unsupported") {
          const [ss, se] = quoteOffsets(seg.text, v.supportingQuote);
          supports.push({
            segmentId: seg.id,
            quote: v.supportingQuote,
            status: v.status,
            confidence: v.confidence,
            sourceStart: ss,
            sourceEnd: se,
          });
        }
      }

      if (supports.length > 0) {
        keptParas.push({ text, supports });
        linksVerified += supports.length;
      } else {
        dropped.push({
          heading: section.heading,
          text,
          reason: cited.length === 0
            ? "no segments cited"
            : "no cited segment passed verification",
        });
      }
    }
    if (keptParas.length > 0) {
      keptSections.push({ heading: section.heading, paragraphs: keptParas });
    }
  }

  const paragraphsKept = keptSections.reduce(
    (n, s) => n + s.paragraphs.length,
    0,
  );
  const result: CreateThemeResult = {
    slug,
    title: input.title,
    thesis: draft.thesis ?? "",
    persisted: false,
    sections: keptSections,
    droppedParagraphs: dropped,
    stats: {
      candidateSegments: segments.length,
      paragraphsTotal,
      paragraphsKept,
      supportLinksVerified: linksVerified,
    },
  };

  // 4) Persist only if requested and something survived verification.
  if (input.persist && paragraphsKept > 0) {
    const ids = await persistTheme(sql ?? getSql(), input, result);
    result.persisted = true;
    result.themeId = ids.themeId;
    result.versionId = ids.versionId;
  }

  return result;
}

function assembleMarkdown(r: CreateThemeResult): string {
  const lines = [`# ${r.title}`, "", `_${r.thesis}_`, ""];
  for (const s of r.sections) {
    lines.push(`## ${s.heading}`, "");
    for (const p of s.paragraphs) lines.push(p.text, "");
  }
  return lines.join("\n");
}

async function persistTheme(
  sql: postgres.Sql,
  input: CreateThemeInput,
  r: CreateThemeResult,
): Promise<{ themeId: string; versionId: string }> {
  const markdown = assembleMarkdown(r);
  const versionHash = await sha256Hex(markdown);

  return await sql.begin(async (tx) => {
    const [theme] = await tx<{ id: string }[]>`
      INSERT INTO theme_index (slug, title, investigative_question, thesis, status)
      VALUES (${r.slug}, ${r.title}, ${input.question ?? null}, ${
      r.thesis || null
    }, 'draft')
      RETURNING id
    `;
    const [version] = await tx<{ id: string }[]>`
      INSERT INTO theme_index_version
        (theme_index_id, version, markdown_text, content_hash, generator_name,
         generator_version, review_status)
      VALUES (${theme.id}, 1, ${markdown}, ${versionHash}, 'lds-corpus-ai',
         '0.1.0', 'generated')
      RETURNING id
    `;
    await tx`UPDATE theme_index SET current_version_id = ${version.id} WHERE id = ${theme.id}`;

    let sectionSeq = 1;
    for (const section of r.sections) {
      const [sec] = await tx<{ id: string }[]>`
        INSERT INTO index_section (theme_index_version_id, heading, sequence, stable_slug)
        VALUES (${version.id}, ${section.heading}, ${sectionSeq},
                ${slugify(section.heading, "sec-" + sectionSeq)})
        RETURNING id
      `;
      let paraSeq = 1;
      for (const para of section.paragraphs) {
        const [p] = await tx<{ id: string }[]>`
          INSERT INTO index_paragraph (index_section_id, sequence, markdown_text, content_hash)
          VALUES (${sec.id}, ${paraSeq}, ${para.text}, ${await sha256Hex(
          para.text,
        )})
          RETURNING id
        `;
        for (const sup of para.supports) {
          await tx`
            INSERT INTO support_link
              (index_paragraph_id, claim_start_char, claim_end_char, segment_id,
               source_start_char, source_end_char, support_type, support_strength,
               verifier_status, verifier_notes)
            VALUES (${p.id}, 0, ${para.text.length}, ${sup.segmentId},
               ${sup.sourceStart}, ${sup.sourceEnd}, 'supports',
               ${supportStrengthFor(sup)}, 'verified',
               ${`Auto-verified (${sup.status}, conf ${
            sup.confidence.toFixed(2)
          }).`})
          `;
        }
        paraSeq++;
      }
      sectionSeq++;
    }
    return { themeId: theme.id, versionId: version.id };
  });
}

function supportStrengthFor(sup: SupportResult): number {
  return supportStrength({
    status: sup.status,
    confidence: sup.confidence,
    supportingQuote: sup.quote,
    rationale: "",
  });
}
