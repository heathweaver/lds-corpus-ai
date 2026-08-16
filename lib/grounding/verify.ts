import type { Anthropic } from "@anthropic-ai/sdk";
import type { LlmClient } from "./llm.ts";
import { verifierModel } from "./llm.ts";

/**
 * Claim ⇐ source entailment verification — the anti-fabrication gate.
 *
 * Given ONLY a single claim and a single source passage, an independent,
 * deliberately skeptical pass decides whether the source actually supports the
 * claim, and must quote the exact supporting words. It never sees the wider
 * narrative or the model that wrote the claim, so it cannot be led. It is
 * instructed to default to `unsupported` whenever the link is not explicit —
 * fail-closed, so uncertainty removes a claim rather than keeping it.
 */

export type SupportStatus = "supported" | "partial" | "unsupported";

export interface Verdict {
  status: SupportStatus;
  /** 0..1 confidence in the judgement. */
  confidence: number;
  /** Exact words from the SOURCE that support the claim (empty if none). */
  supportingQuote: string;
  /** Short reason, especially when partial/unsupported. */
  rationale: string;
}

const SYSTEM = `You are a strict citation checker for a historical/scriptural
corpus. You are given ONE claim and ONE source passage. Decide ONLY whether the
source passage, on its own, supports the claim.

Rules:
- Judge solely on what the source passage literally says. Use no outside
  knowledge and make no inferences beyond what the words state.
- "supported": the source directly states or unambiguously entails the claim.
- "partial": the source supports part of the claim but not all of it, or only
  weakly implies it.
- "unsupported": the source does not support the claim, is about something else,
  or you are not sure. When in doubt, choose unsupported.
- You MUST provide the exact supporting words copied verbatim from the SOURCE.
  If you cannot quote support from the source, the status is "unsupported" and
  the quote is empty.
- Do not reward fluent or plausible claims. Plausibility is irrelevant; only
  textual support counts.`;

const TOOL: Anthropic.Tool = {
  name: "record_verdict",
  description: "Record whether the source passage supports the claim.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["supported", "partial", "unsupported"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      supporting_quote: {
        type: "string",
        description:
          "Verbatim words from the SOURCE that support the claim; empty if none.",
      },
      rationale: { type: "string" },
    },
    required: ["status", "confidence", "supporting_quote", "rationale"],
    additionalProperties: false,
  },
};

interface RawVerdict {
  status?: SupportStatus;
  confidence?: number;
  supporting_quote?: string;
  rationale?: string;
}

/** Verify a single claim against a single source passage. Fail-closed. */
export async function verifyEntailment(
  llm: LlmClient,
  claim: string,
  source: string,
): Promise<Verdict> {
  const raw = await llm.toolCall<RawVerdict>({
    system: SYSTEM,
    cacheSystem: true,
    model: verifierModel(),
    maxTokens: 400,
    tool: TOOL,
    user: `CLAIM:\n${claim}\n\nSOURCE PASSAGE:\n${source}`,
  });

  const status: SupportStatus = raw.status ?? "unsupported";
  const quote = (raw.supporting_quote ?? "").trim();
  const confidence = clamp01(raw.confidence);

  // Fail-closed integrity checks: a "supported"/"partial" verdict must carry a
  // quote that actually appears in the source. Otherwise downgrade.
  if (status !== "unsupported") {
    if (!quote || !sourceContains(source, quote)) {
      return {
        status: "unsupported",
        confidence: Math.min(confidence, 0.3),
        supportingQuote: "",
        rationale: (raw.rationale ? raw.rationale + " " : "") +
          "(Downgraded: no verbatim supporting quote found in source.)",
      };
    }
  }

  return {
    status,
    confidence,
    supportingQuote: quote,
    rationale: raw.rationale ?? "",
  };
}

/** A claim is accepted only if supported (or strongly partial) with confidence. */
export function isAccepted(v: Verdict, minConfidence = 0.6): boolean {
  if (v.status === "supported") return v.confidence >= minConfidence;
  if (v.status === "partial") return v.confidence >= 0.8;
  return false;
}

/** Map a verdict to a support_strength (numeric(5,4)) for persistence. */
export function supportStrength(v: Verdict): number {
  const base = v.status === "supported" ? 1 : v.status === "partial" ? 0.6 : 0;
  return Math.round(base * v.confidence * 10000) / 10000;
}

function clamp01(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Whitespace/case-insensitive containment check for quote validation. */
function sourceContains(source: string, quote: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(source).includes(norm(quote));
}
