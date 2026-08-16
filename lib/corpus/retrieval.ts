import { getSegmentById } from "./segments.ts";
import { linkedSegmentIds, searchIndexes } from "./indexes.ts";
import { hybridSearch } from "../retrieval/hybrid.ts";
import { composeAnswer } from "./answer.ts";
import { logResearchQuery } from "../metrics/log.ts";
import { findSimilarQuestions } from "../metrics/dedup.ts";
import type { AskResult, IndexNote, Segment } from "./types.ts";

export interface AskInput {
  question: string;
  collection?: string;
  author?: string;
  /** Cap on segments fed to answer composition. */
  maxSegments?: number;
}

/** How many top indexes guide retrieval, and how many segments per index. */
const MAX_INDEXES = 4;
const MAX_SEGMENTS = 12;

/**
 * Retrieval flow: Question → theme indexes → relevant segments → answer.
 *
 * Indexes guide retrieval toward likely material; the actual segment text is
 * then read before answering. When no theme indexes are populated/matched, the
 * system searches the segment source view directly (per the spec).
 */
export async function ask(input: AskInput): Promise<AskResult> {
  const question = input.question.trim();
  const maxSegments = input.maxSegments ?? MAX_SEGMENTS;

  // 1) Which theme indexes look relevant?
  const indexes = await searchIndexes(question, MAX_INDEXES);

  // 2) Gather candidate segments from the indexes they point toward.
  let segments: Segment[] = [];
  let mode: "index" | "segment" = "segment";
  const followed: IndexNote[] = [];

  if (indexes.length > 0) {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const idx of indexes) {
      const segIds = await linkedSegmentIds(idx.id);
      if (segIds.length > 0) followed.push(idx);
      for (const sid of segIds) {
        if (!seen.has(sid)) {
          seen.add(sid);
          ids.push(sid);
        }
      }
    }
    if (ids.length > 0) {
      const fetched = await Promise.all(
        ids.slice(0, maxSegments).map((id) => getSegmentById(id)),
      );
      segments = fetched.filter((s): s is Segment => s !== null);
      mode = "index";
    }
  }

  // 3) Fall back to direct segment search when indexes yielded nothing.
  //    Hybrid (keyword + semantic when configured) maximizes recall here.
  if (segments.length === 0) {
    segments = await hybridSearch(
      question,
      { collection: input.collection, author: input.author },
      maxSegments,
    );
    mode = "segment";
  }

  // 4) Compose a grounded answer from the actual segment text.
  const { answer, citations, grounding } = await composeAnswer(
    question,
    segments,
  );

  // Query dedup: surface near-duplicate prior questions BEFORE logging this one
  // (so it can't match itself), so callers can reuse instead of re-running.
  const similar = await findSimilarQuestions(question);

  const result: AskResult = {
    answer,
    indexes: mode === "index" ? followed : indexes,
    citations,
    grounding,
    similar,
    scope: {
      mode,
      indexesFollowed: (mode === "index" ? followed : indexes).map((i) =>
        i.title
      ),
      segmentCount: segments.length,
      collection: input.collection ?? null,
      author: input.author ?? null,
    },
  };

  // Demand signal for curation (best-effort; no-op without a writable role).
  await logResearchQuery(question, result);
  return result;
}
