# The knowledge base — a grounded encyclopedia over a closed corpus

This app is, at heart, a **small search engine + a curated encyclopedia** over
a fixed, canonical corpus. Because the corpus is closed, every statement is
mechanically checkable against primary sources — so accuracy is a measurable
property, not a hope.

## Ranking signals (there is no recency)

Web search leans on recency + popularity (PageRank/clicks). A canonical corpus
has neither, so ranking uses:

- **Relevance** — hybrid keyword (`segment.search_vector`, `ts_rank_cd`) +
  semantic (pgvector) fused by RRF (`lib/retrieval/hybrid.ts`).
- **Authority (replaces PageRank)** — citation fan-in: a segment cited by many
  theme paragraphs (`support_link`) is a load-bearing passage; canonical works
  outrank secondary ones. *(planned as an explicit ranking boost)*
- **Quality / provenance** — `text_layer.quality_score`, verification status,
  contribution certainty. *(planned)*

## Faithfulness (the invariant)

Generation is separated from verification (`lib/grounding/`). An independent,
fail-closed verifier judges each claim against a specific source span and must
quote it; unsupported claims are dropped. This holds for both `/research/ask`
and theme creation. See the main README "Grounding" section.

## Two shapes: consumer vs. curation

| | Consumer (`/research/ask`, `/mcp`) | Internal curation |
| --- | --- | --- |
| Mode | low-latency, per-question, **read-only** | batch, versioned, **writes** |
| DB role | `lds_corpus_app` (read-only) | `lds_corpus_curator` (writable, scoped) |
| Verification | one pass | adversarial / multi-vote *(planned)* |

The writable role (`sql/curator_role.sql`) can read all of `lds_corpus`, write
**only** the KB tables (`theme_index` and descendants + `support_link`), and
owns the operational `corpus_ai` schema (`sql/app_schema.sql`). The public app
never uses it.

## Measurement + demand (built)

- **Demand logging** — every research question and its groundedness is logged
  to `corpus_ai.query_log` (best-effort, only when the writable role is
  configured). Low-groundedness questions are the **editorial backlog**: topics
  the encyclopedia doesn't yet answer well.
- **Query dedup** — near-duplicate questions are detected via pg_trgm
  similarity over the log and surfaced on `/research/ask` (`similar`), so
  callers reuse instead of re-running expensive work.
- **KB metrics** — `GET /metrics`, the `corpus_metrics` MCP tool, and
  `deno task metrics [-- --snapshot]` report coverage / faithfulness /
  freshness / demand. Snapshots (`corpus_ai.metric_snapshot`) make improvement
  a measurable delta.

## Curation loop (planned — next)

Driven by the two gap signals above (coverage gaps from the taxonomy; demand
gaps from the query log):

1. **Propose** articles for uncovered topics / poorly-answered questions.
2. **Generate** (verified drafter) with a precision floor — abstain when
   sources are thin.
3. **Audit** — adversarial multi-vote refutation; the article's faithfulness
   score is the survival rate, tracked per version.
4. **Re-verify on drift** when a new `corpus_snapshot` lands.
5. **Detect contradictions / duplicate articles** — the encyclopedia must not
   hold two articles on one topic (merge/redirect).
6. **Human promote** `draft` → `published`; auto-promote only above a measured
   confidence with sampled QA.
