import { assertEquals } from "@std/assert";
import { rrfFuse } from "../lib/retrieval/hybrid.ts";

Deno.test("rrfFuse ranks items strong in multiple lists first", () => {
  // list1: a,b,c   list2: b,c,a  → b wins (rank1+rank0), then a, then c.
  assertEquals(rrfFuse([["a", "b", "c"], ["b", "c", "a"]]), ["b", "a", "c"]);
});

Deno.test("rrfFuse rewards agreement across lists", () => {
  // x is top of both lists → must rank first.
  const out = rrfFuse([["x", "y"], ["x", "z"]]);
  assertEquals(out[0], "x");
});

Deno.test("rrfFuse handles a single list (identity order)", () => {
  assertEquals(rrfFuse([["a", "b", "c"]]), ["a", "b", "c"]);
});
