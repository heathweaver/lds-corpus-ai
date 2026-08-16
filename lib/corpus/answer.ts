import type { Anthropic } from "@anthropic-ai/sdk";
import {
  anthropicClient,
  llmAvailable,
  type LlmClient,
} from "../grounding/llm.ts";
import { isAccepted, verifyEntailment } from "../grounding/verify.ts";
import type { Citation, GroundingReport, Segment } from "./types.ts";

/**
 * Grounded answer composition with mandatory, fail-closed verification.
 *
 *   1. GENERATE: the model answers as a list of atomic claims, each citing the
 *      segment numbers it used (forced tool-use, no free prose).
 *   2. VERIFY: an INDEPENDENT skeptical pass (verify.ts) checks each claim
 *      against its cited segment text and must quote support.
 *   3. DROP: claims that no cited source supports are removed from the answer,
 *      not shown. The response reports how many were dropped.
 *
 * With no ANTHROPIC_API_KEY, falls back to an extractive answer — top segments
 * quoted directly — which is grounded by construction (it only quotes).
 */

const SEGMENT_CHAR_CAP = 1500;
const MAX_SEGMENTS = 12;

export interface ComposedAnswer {
  answer: string;
  citations: Citation[];
  grounding: GroundingReport;
}

function sourceLabel(seg: Segment): string {
  const parts = [seg.documentTitle, seg.reference].filter(Boolean);
  const base = parts.join(", ") || seg.collection || "source";
  return seg.author ? `${base} — ${seg.author}` : base;
}

function citationFor(
  seg: Segment,
  quote: string,
  status: "supported" | "partial",
  confidence: number,
): Citation {
  return {
    segmentId: seg.id,
    documentTitle: seg.documentTitle,
    author: seg.author,
    reference: seg.reference,
    sourceUrl: seg.sourceUrl,
    quote: quote || seg.text.slice(0, SEGMENT_CHAR_CAP),
    status,
    confidence,
  };
}

const SYSTEM =
  `You are a research assistant for a corpus of Latter-day Saint scripture and ` +
  `early LDS historical texts. Answer the user's question using ONLY the ` +
  `numbered source segments provided. Break your answer into short, atomic ` +
  `claims (one assertion each). For every claim, list the segment numbers that ` +
  `directly support it. Never assert anything not supported by a listed ` +
  `segment. If the segments do not answer the question, return no claims.`;

const TOOL: Anthropic.Tool = {
  name: "compose_answer",
  description: "Return the answer as atomic, individually-cited claims.",
  input_schema: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "One atomic assertion." },
            cited_segments: {
              type: "array",
              items: { type: "integer" },
              description: "1-based segment numbers that support this claim.",
            },
          },
          required: ["text", "cited_segments"],
          additionalProperties: false,
        },
      },
    },
    required: ["claims"],
    additionalProperties: false,
  },
};

interface RawClaim {
  text: string;
  cited_segments: number[];
}

function renderSegments(segments: Segment[]): string {
  return segments
    .map((s, i) =>
      `[${i + 1}] (${sourceLabel(s)})\n${s.text.slice(0, SEGMENT_CHAR_CAP)}`
    )
    .join("\n\n");
}

async function groundedAnswer(
  llm: LlmClient,
  question: string,
  segments: Segment[],
): Promise<ComposedAnswer> {
  const { claims } = await llm.toolCall<{ claims: RawClaim[] }>({
    system: SYSTEM,
    cacheSystem: true,
    maxTokens: 1200,
    tool: TOOL,
    user: `Question: ${question}\n\nSource segments:\n\n${
      renderSegments(segments)
    }`,
  });

  const kept: string[] = [];
  const dropped: string[] = [];
  const citations: Citation[] = [];
  const seenCitation = new Set<string>();

  for (const claim of claims ?? []) {
    const text = claim.text?.trim();
    if (!text) continue;
    const cited = (claim.cited_segments ?? [])
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= segments.length)
      .map((n) => segments[n - 1]);

    // Verify the claim against each cited segment independently; keep it only
    // if at least one cited source genuinely supports it.
    let best: {
      seg: Segment;
      quote: string;
      status: "supported" | "partial";
      conf: number;
    } | null = null;
    for (const seg of cited) {
      const v = await verifyEntailment(llm, text, seg.text);
      if (
        isAccepted(v) && (v.status === "supported" || v.status === "partial")
      ) {
        if (!best || v.confidence > best.conf) {
          best = {
            seg,
            quote: v.supportingQuote,
            status: v.status,
            conf: v.confidence,
          };
        }
      }
    }

    if (best) {
      kept.push(text);
      const key = best.seg.id;
      if (!seenCitation.has(key)) {
        seenCitation.add(key);
        citations.push(
          citationFor(best.seg, best.quote, best.status, best.conf),
        );
      }
    } else {
      dropped.push(text);
    }
  }

  const total = (claims ?? []).length;
  const answer = kept.length > 0
    ? kept.join(" ")
    : "The available sources do not directly support an answer to this question.";

  return {
    answer,
    citations,
    grounding: {
      mode: "verified",
      claimsTotal: total,
      claimsSupported: kept.length,
      claimsDropped: dropped,
      score: total === 0 ? 1 : kept.length / total,
    },
  };
}

function extractiveAnswer(segments: Segment[]): ComposedAnswer {
  const top = segments.slice(0, 3);
  if (top.length === 0) {
    return {
      answer:
        "No source segments matched this question. Try rephrasing or broadening the scope.",
      citations: [],
      grounding: {
        mode: "extractive",
        claimsTotal: 0,
        claimsSupported: 0,
        claimsDropped: [],
        score: 1,
      },
    };
  }
  const lead =
    `Drawing on ${segments.length} matching source segment${
      segments.length === 1 ? "" : "s"
    }, ` +
    `the most relevant passages are:`;
  const body = top
    .map((s, i) =>
      `[${i + 1}] ${s.text.slice(0, 400).trim()}${
        s.text.length > 400 ? "…" : ""
      } ` +
      `(${sourceLabel(s)})`
    )
    .join("\n\n");
  return {
    answer: `${lead}\n\n${body}`,
    citations: top.map((s) =>
      citationFor(s, s.text.slice(0, SEGMENT_CHAR_CAP), "supported", 1)
    ),
    grounding: {
      mode: "extractive",
      claimsTotal: top.length,
      claimsSupported: top.length,
      claimsDropped: [],
      score: 1,
    },
  };
}

/**
 * Compose a grounded answer. `llm` is injectable for tests; in production it
 * defaults to the Anthropic client when ANTHROPIC_API_KEY is set, else the
 * extractive fallback.
 */
export async function composeAnswer(
  question: string,
  segments: Segment[],
  llm?: LlmClient,
): Promise<ComposedAnswer> {
  const capped = segments.slice(0, MAX_SEGMENTS);
  const client = llm ?? (llmAvailable() ? anthropicClient() : null);
  if (client) {
    try {
      return await groundedAnswer(client, question, capped);
    } catch (err) {
      console.error("Grounded synthesis failed, using extractive answer:", err);
    }
  }
  return extractiveAnswer(capped);
}
