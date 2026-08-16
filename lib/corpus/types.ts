// Domain types for the research UI. These are the shapes the API returns and
// the frontend consumes; they are deliberately decoupled from the exact
// Postgres column names (which are resolved at runtime in db-introspect.ts).

export interface Segment {
  id: string;
  /** The segment text itself. */
  text: string;
  documentId: string | null;
  documentTitle: string | null;
  author: string | null;
  date: string | null;
  edition: string | null;
  sourceUrl: string | null;
  /** Human-readable locator, e.g. "Alma 32:21" or a paragraph ref. */
  reference: string | null;
  /** Collection / work / volume this belongs to. */
  collection: string | null;
  /** Ordering position within the document (for surrounding context). */
  ordinal: number | null;
}

/** A cited segment plus the segments immediately around it. */
export interface SegmentContext {
  segment: Segment;
  before: Segment[];
  after: Segment[];
}

export interface DocumentDetail {
  id: string;
  title: string | null;
  author: string | null;
  date: string | null;
  edition: string | null;
  collection: string | null;
  sourceUrl: string | null;
  segments: Segment[];
}

/** A Zettelkasten-style theme index note. */
export interface IndexNote {
  id: string;
  title: string;
  note: string | null;
  /** Related index ids/titles surfaced when an index is opened. */
  related?: { id: string; title: string }[];
  /** Source segments this index points toward. */
  segmentIds?: string[];
}

export interface Citation {
  segmentId: string;
  documentTitle: string | null;
  author: string | null;
  reference: string | null;
  sourceUrl: string | null;
  /** The quoted text backing this citation. */
  quote: string;
  /** Verifier verdict for the claim this citation supports. */
  status?: "supported" | "partial";
  confidence?: number;
}

/** Transparency report on how well the answer is grounded in sources. */
export interface GroundingReport {
  /** "verified" = every shown claim passed entailment; "extractive" = quotes only. */
  mode: "verified" | "extractive";
  claimsTotal: number;
  claimsSupported: number;
  /** Claims removed because no cited source supported them. */
  claimsDropped: string[];
  /** claimsSupported / claimsTotal (1 when there were no claims). */
  score: number;
}

export interface RetrievalScope {
  /** "index" when theme indexes guided retrieval, "segment" for direct search. */
  mode: "index" | "segment";
  indexesFollowed: string[];
  segmentCount: number;
  collection?: string | null;
  author?: string | null;
}

export interface AskResult {
  answer: string;
  indexes: IndexNote[];
  citations: Citation[];
  scope: RetrievalScope;
  grounding: GroundingReport;
}

export interface SearchFilters {
  q?: string;
  collection?: string;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}
