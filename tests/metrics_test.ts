import { assertEquals } from "@std/assert";
import { queryLogEntry } from "../lib/metrics/log.ts";
import type { AskResult } from "../lib/corpus/types.ts";

Deno.test("queryLogEntry maps an AskResult to a log row", () => {
  const result: AskResult = {
    answer: "…",
    indexes: [],
    citations: [],
    similar: [],
    grounding: {
      mode: "verified",
      claimsTotal: 4,
      claimsSupported: 3,
      claimsDropped: ["x"],
      score: 0.75,
    },
    scope: {
      mode: "index",
      indexesFollowed: ["Faith and Belief"],
      segmentCount: 6,
      collection: "Book of Mormon",
      author: null,
    },
  };

  const e = queryLogEntry("How is faith described?", result);
  assertEquals(e.question, "How is faith described?");
  assertEquals(e.mode, "index");
  assertEquals(e.groundingMode, "verified");
  assertEquals(e.claimsTotal, 4);
  assertEquals(e.claimsSupported, 3);
  assertEquals(e.groundedness, 0.75);
  assertEquals(e.segmentCount, 6);
  assertEquals(e.indexesFollowed, ["Faith and Belief"]);
  assertEquals(e.collection, "Book of Mormon");
  assertEquals(e.author, null);
});
