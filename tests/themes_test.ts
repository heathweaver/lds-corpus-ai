import { assert, assertEquals } from "@std/assert";
import type { LlmClient } from "../lib/grounding/llm.ts";
import { createTheme } from "../lib/themes/create.ts";
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

// Writer drafts one supported paragraph and one fabricated one; the verifier
// only "supports" claims whose source literally shares the word "faith".
const mockLlm: LlmClient = {
  defaultModel: "mock",
  // deno-lint-ignore no-explicit-any
  toolCall(req: any): Promise<any> {
    if (req.tool.name === "draft_theme") {
      return Promise.resolve({
        thesis: "Faith precedes knowledge.",
        sections: [
          {
            heading: "Faith and knowledge",
            paragraphs: [
              {
                text: "Faith is not to have a perfect knowledge.",
                cited_segments: [1],
              },
            ],
          },
          {
            heading: "Fabricated",
            paragraphs: [
              {
                text: "A temple was dedicated in 1850 by decree.",
                cited_segments: [2],
              },
            ],
          },
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
            rationale: "Direct.",
          }
          : {
            status: "unsupported",
            confidence: 0.9,
            supporting_quote: "",
            rationale: "Unrelated.",
          },
      );
    }
    return Promise.reject(new Error("unexpected tool " + req.tool.name));
  },
};

Deno.test("theme creation drops paragraphs no source supports (dry run)", async () => {
  const candidates = [
    seg(
      "s1",
      "And now as I said concerning faith—faith is not to have a perfect knowledge of things.",
    ),
    seg(
      "s2",
      "Behold the tree grew and brought forth fruit unto the preserving of its root.",
    ),
  ];
  const r = await createTheme(
    {
      title: "Faith and Belief",
      question: "How is faith described?",
      candidates,
      persist: false,
    },
    mockLlm,
  );

  assertEquals(r.persisted, false);
  assertEquals(r.stats.paragraphsTotal, 2);
  assertEquals(r.stats.paragraphsKept, 1);
  assertEquals(r.stats.supportLinksVerified, 1);
  assertEquals(r.sections.length, 1);
  assertEquals(r.sections[0].heading, "Faith and knowledge");
  assertEquals(r.droppedParagraphs.length, 1);
  assert(r.droppedParagraphs[0].text.includes("temple"));
  // The one kept support carries located source offsets.
  const sup = r.sections[0].paragraphs[0].supports[0];
  assertEquals(sup.segmentId, "s1");
  assert(sup.sourceStart !== null && sup.sourceEnd !== null);
});
