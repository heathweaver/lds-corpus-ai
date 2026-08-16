import { assert, assertEquals } from "@std/assert";
import type { LlmClient } from "../lib/grounding/llm.ts";
import { verifyEntailment } from "../lib/grounding/verify.ts";
import { composeAnswer } from "../lib/corpus/answer.ts";
import type { Segment } from "../lib/corpus/types.ts";

function seg(id: string, text: string): Segment {
  return {
    id,
    text,
    documentId: "d",
    documentTitle: "Alma",
    author: null,
    date: null,
    edition: null,
    sourceUrl: null,
    reference: id,
    collection: "Book of Mormon",
    ordinal: 1,
  };
}

/**
 * Mock LLM: generates two claims (one true-to-source, one fabricated) and a
 * verifier that only "supports" a claim when the source passage literally
 * shares the salient word — and copies a verbatim quote (so the fail-closed
 * quote-in-source check passes for the real one).
 */
const mockLlm: LlmClient = {
  defaultModel: "mock",
  // deno-lint-ignore no-explicit-any
  toolCall(req: any): Promise<any> {
    if (req.tool.name === "compose_answer") {
      return Promise.resolve({
        claims: [
          {
            text: "Faith is not to have a perfect knowledge.",
            cited_segments: [1],
          },
          { text: "Prayer guarantees earthly wealth.", cited_segments: [2] },
        ],
      });
    }
    if (req.tool.name === "record_verdict") {
      const [, claimPart, sourcePart] =
        req.user.match(/CLAIM:\n([\s\S]*?)\n\nSOURCE PASSAGE:\n([\s\S]*)$/) ??
          [];
      const claim = (claimPart ?? "").toLowerCase();
      const source = (sourcePart ?? "").toLowerCase();
      const supported = claim.includes("faith") && source.includes("faith");
      return Promise.resolve(
        supported
          ? {
            status: "supported",
            confidence: 0.9,
            supporting_quote: "faith is not to have a perfect knowledge",
            rationale: "Source states it directly.",
          }
          : {
            status: "unsupported",
            confidence: 0.9,
            supporting_quote: "",
            rationale: "Source is unrelated to the claim.",
          },
      );
    }
    return Promise.reject(new Error("unexpected tool " + req.tool.name));
  },
};

Deno.test("grounded answer drops claims no source supports", async () => {
  const segments = [
    seg(
      "s1",
      "And now as I said concerning faith—faith is not to have a perfect knowledge of things.",
    ),
    seg(
      "s2",
      "Behold the tree grew and brought forth fruit unto the preserving of its root.",
    ),
  ];
  const r = await composeAnswer("What is faith?", segments, mockLlm);

  assertEquals(r.grounding.mode, "verified");
  assertEquals(r.grounding.claimsTotal, 2);
  assertEquals(r.grounding.claimsSupported, 1);
  assert(r.grounding.claimsDropped.some((c) => c.includes("wealth")));
  assert(r.answer.includes("perfect knowledge"));
  assert(!r.answer.toLowerCase().includes("wealth"));
  assertEquals(r.citations.length, 1);
  assertEquals(r.citations[0].segmentId, "s1");
  assertEquals(r.citations[0].status, "supported");
});

Deno.test("verifier fails closed when the 'supporting' quote is not in the source", async () => {
  // A model that claims support but fabricates a quote not present in the source.
  const liar: LlmClient = {
    defaultModel: "mock",
    // deno-lint-ignore no-explicit-any
    toolCall(_req: any): Promise<any> {
      return Promise.resolve({
        status: "supported",
        confidence: 0.99,
        supporting_quote: "this sentence is nowhere in the source",
        rationale: "trust me",
      });
    },
  };
  const v = await verifyEntailment(
    liar,
    "Some claim.",
    "A completely different source text.",
  );
  assertEquals(v.status, "unsupported");
  assert(v.rationale.toLowerCase().includes("downgraded"));
});
