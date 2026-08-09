import Anthropic from "@anthropic-ai/sdk";
import type { Citation, Segment } from "./types.ts";

/**
 * Grounded answer composition.
 *
 * Two modes, chosen at runtime:
 *  - Claude synthesis (when ANTHROPIC_API_KEY is set): mirrors the forced
 *    tool-use + cached-system-block pattern from twiglit-notes
 *    lib/consolidate/claude.ts. The model is required to answer ONLY from the
 *    supplied segments and to declare which ones it used.
 *  - Extractive fallback (no key): stitches the top segments into a short
 *    answer with citation markers. No external calls — safe for offline/dev.
 */

const SEGMENT_CHAR_CAP = 1500;
const MAX_SEGMENTS = 12;

export interface ComposedAnswer {
  answer: string;
  citations: Citation[];
}

function citationFor(seg: Segment): Citation {
  return {
    segmentId: seg.id,
    documentTitle: seg.documentTitle,
    author: seg.author,
    reference: seg.reference,
    sourceUrl: seg.sourceUrl,
    quote: seg.text.slice(0, SEGMENT_CHAR_CAP),
  };
}

function sourceLabel(seg: Segment): string {
  const parts = [seg.documentTitle, seg.reference].filter(Boolean);
  const base = parts.join(", ") || seg.collection || "source";
  return seg.author ? `${base} — ${seg.author}` : base;
}

const SYSTEM_PROMPT =
  `You are a research assistant for a corpus of Latter-day Saint scripture and ` +
  `early LDS historical texts. Answer the user's question using ONLY the ` +
  `numbered source segments provided. Do not use outside knowledge. If the ` +
  `segments do not contain the answer, say so plainly. Keep the answer concise ` +
  `and grounded; cite segments by their number in square brackets like [2]. ` +
  `Then report exactly which segment numbers you relied on.`;

const COMPOSE_TOOL: Anthropic.Tool = {
  name: "compose_answer",
  description: "Return a grounded answer and the segment numbers it relied on.",
  input_schema: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "Concise answer grounded only in the provided segments, with [n] citations.",
      },
      cited_segments: {
        type: "array",
        items: { type: "integer" },
        description: "1-based numbers of the segments actually used.",
      },
    },
    required: ["answer", "cited_segments"],
    additionalProperties: false,
  },
};

function renderSegments(segments: Segment[]): string {
  return segments
    .map((s, i) => `[${i + 1}] (${sourceLabel(s)})\n${s.text.slice(0, SEGMENT_CHAR_CAP)}`)
    .join("\n\n");
}

async function synthesizeWithClaude(
  question: string,
  segments: Segment[],
): Promise<ComposedAnswer> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [COMPOSE_TOOL],
    tool_choice: { type: "tool", name: "compose_answer" },
    messages: [{
      role: "user",
      content: `Question: ${question}\n\nSource segments:\n\n${renderSegments(segments)}`,
    }],
  });
  const block = res.content.find((b) => b.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  const input = (block?.input ?? {}) as { answer?: string; cited_segments?: number[] };
  const answer = input.answer?.trim() || "No answer could be composed from the sources.";
  const cited = (input.cited_segments ?? [])
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= segments.length)
    .map((n) => segments[n - 1]);
  const used = cited.length > 0 ? cited : segments.slice(0, 3);
  return { answer, citations: used.map(citationFor) };
}

function extractiveAnswer(question: string, segments: Segment[]): ComposedAnswer {
  const top = segments.slice(0, 3);
  if (top.length === 0) {
    return {
      answer: `No source segments matched this question. Try rephrasing or broadening the scope.`,
      citations: [],
    };
  }
  const lead =
    `Drawing on ${segments.length} matching source segment${segments.length === 1 ? "" : "s"}, ` +
    `the most relevant passages are:`;
  const body = top
    .map((s, i) => `[${i + 1}] ${s.text.slice(0, 400).trim()}${s.text.length > 400 ? "…" : ""} ` +
      `(${sourceLabel(s)})`)
    .join("\n\n");
  return {
    answer: `${lead}\n\n${body}`,
    citations: top.map(citationFor),
  };
}

/** Compose a grounded answer from retrieved segments. */
export async function composeAnswer(
  question: string,
  segments: Segment[],
): Promise<ComposedAnswer> {
  const capped = segments.slice(0, MAX_SEGMENTS);
  if (Deno.env.get("ANTHROPIC_API_KEY")) {
    try {
      return await synthesizeWithClaude(question, capped);
    } catch (err) {
      // Never fail the request because synthesis was unavailable; fall back.
      console.error("Claude synthesis failed, using extractive answer:", err);
    }
  }
  return extractiveAnswer(question, capped);
}
