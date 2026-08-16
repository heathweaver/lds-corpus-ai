// Barrel for the db + corpus data layer, aliased as `$db` in deno.json.
export {
  closePool,
  DbNotConfiguredError,
  getSql,
  isDbConfigured,
  SCHEMA,
  withClient,
} from "./postgres-base.ts";

export {
  getDocument,
  getSegmentById,
  getSegmentContext,
  searchSegments,
  SegmentSourceUnavailableError,
} from "../corpus/segments.ts";

export {
  getIndex,
  indexesAvailable,
  linkedSegmentIds,
  searchIndexes,
} from "../corpus/indexes.ts";
export { ask } from "../corpus/retrieval.ts";
export { composeAnswer } from "../corpus/answer.ts";

export type {
  AskResult,
  Citation,
  DocumentDetail,
  GroundingReport,
  IndexNote,
  RetrievalScope,
  SearchFilters,
  Segment,
  SegmentContext,
} from "../corpus/types.ts";
