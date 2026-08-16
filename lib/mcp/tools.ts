import { ask } from "../corpus/retrieval.ts";
import {
  getDocument,
  getSegmentById,
  getSegmentContext,
} from "../corpus/segments.ts";
import { getIndex, searchIndexes } from "../corpus/indexes.ts";
import { hybridSearch } from "../retrieval/hybrid.ts";
import { createTheme } from "../themes/create.ts";
import { anthropicClient, llmAvailable } from "../grounding/llm.ts";
import { computeMetrics } from "../metrics/metrics.ts";
import type { Segment } from "../corpus/types.ts";

/**
 * Research tools exposed to AI runtimes (the Twiglit runtime, Claude, ChatGPT
 * deep-research) over the /mcp endpoint. Every tool reuses the same verified
 * core the human UI uses — so a machine caller gets the same rigor: grounded
 * answers with unsupported claims dropped, and theme docs whose every paragraph
 * is backed by a verified source span.
 */

// deno-lint-ignore no-explicit-any
type Json = any;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Json;
  /** Human-facing rich tool (structured JSON result). */
  handler: (args: Json) => Promise<Json>;
}

function segmentTitle(
  s: { documentTitle: string | null; reference: string | null },
): string {
  return [s.documentTitle, s.reference].filter(Boolean).join(", ") || "source";
}

export const TOOLS: McpTool[] = [
  {
    name: "research_ask",
    description:
      "Ask a natural-language research question of the LDS corpus and get a GROUNDED answer: every claim is independently verified against cited source segments and unsupported claims are dropped. Returns the answer, citations (with quotes), the theme indexes followed, retrieval scope, and a groundedness report.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        collection: {
          type: "string",
          description: "Optional work/collection filter.",
        },
        author: { type: "string", description: "Optional author filter." },
      },
      required: ["question"],
    },
    handler: (a) =>
      ask({
        question: String(a.question),
        collection: a.collection,
        author: a.author,
      }),
  },
  {
    name: "search_corpus",
    description:
      "Search source segments (concepts, stories, quotes) by keyword — hybrid keyword+semantic when embeddings are configured. Filter by collection, author, and date. Returns matching segments with provenance.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        collection: { type: "string" },
        author: { type: "string" },
        dateFrom: { type: "string", description: "ISO date lower bound." },
        dateTo: { type: "string", description: "ISO date upper bound." },
        limit: { type: "integer" },
      },
      required: ["q"],
    },
    handler: async (a) => ({
      segments: await hybridSearch(String(a.q), {
        collection: a.collection,
        author: a.author,
        dateFrom: a.dateFrom,
        dateTo: a.dateTo,
      }, a.limit ?? 24),
    }),
  },
  {
    name: "get_segment",
    description:
      "Fetch a source segment in its surrounding reading context, with full provenance.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, window: { type: "integer" } },
      required: ["id"],
    },
    handler: (a) => getSegmentContext(String(a.id), a.window ?? 3),
  },
  {
    name: "get_document",
    description: "Fetch a document's metadata and its ordered segments.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, limit: { type: "integer" } },
      required: ["id"],
    },
    handler: (a) => getDocument(String(a.id), a.limit ?? 1000),
  },
  {
    name: "search_indexes",
    description:
      "Search the Zettelkasten theme indexes (title, thesis, question).",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, limit: { type: "integer" } },
      required: ["q"],
    },
    handler: async (a) => ({
      indexes: await searchIndexes(String(a.q ?? ""), a.limit ?? 20),
    }),
  },
  {
    name: "get_index",
    description:
      "Fetch a theme index with its linked source segment ids and related indexes (by shared supporting segments).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: (a) => getIndex(String(a.id)),
  },
  {
    name: "generate_theme",
    description:
      "Generate a rigorous theme document over the corpus: sections/paragraphs are drafted, then EACH paragraph is independently verified against its cited source segments; unsupported paragraphs are dropped. Returns the verified structure (dry run — does not persist). Requires ANTHROPIC_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        question: { type: "string", description: "Investigative question." },
        collection: { type: "string" },
        author: { type: "string" },
        maxSegments: { type: "integer" },
      },
      required: ["title"],
    },
    handler: (a) => {
      if (!llmAvailable()) {
        throw new Error("generate_theme requires ANTHROPIC_API_KEY");
      }
      return createTheme({
        title: String(a.title),
        question: a.question,
        scope: { collection: a.collection, author: a.author },
        maxSegments: a.maxSegments,
        persist: false,
      }, anthropicClient());
    },
  },
  {
    name: "corpus_metrics",
    description:
      "Report knowledge-base health: coverage (segments cited, themes), faithfulness (verified support ratio, avg strength), freshness, and demand (question groundedness). Use to see what the encyclopedia covers well and where it is weak.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: () => computeMetrics(),
  },
  // --- Deep-research contract pair (ChatGPT/others) -------------------------
  {
    name: "search",
    description:
      "Deep-research search: return lightweight {id,title,url} results for a query over the corpus.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: async (a) => {
      const segs = await hybridSearch(String(a.query), {}, 20);
      return {
        results: segs.map((s: Segment) => ({
          id: s.id,
          title: segmentTitle(s),
          url: s.sourceUrl ?? "",
        })),
      };
    },
  },
  {
    name: "fetch",
    description:
      "Deep-research fetch: return the full text and metadata for a segment id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (a) => {
      const s = await getSegmentById(String(a.id));
      if (!s) throw new Error(`Segment ${a.id} not found`);
      return {
        id: s.id,
        title: segmentTitle(s),
        text: s.text,
        url: s.sourceUrl ?? "",
        metadata: {
          author: s.author,
          date: s.date,
          edition: s.edition,
          collection: s.collection,
          reference: s.reference,
          documentId: s.documentId,
        },
      };
    },
  },
];

export const TOOL_MAP: Map<string, McpTool> = new Map(
  TOOLS.map((t) => [t.name, t]),
);
