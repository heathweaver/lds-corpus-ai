-- Operational schema for the app's own data (NOT the source corpus).
-- Kept separate from `lds_corpus` so the read-only consumer role never touches
-- it and the corpus schema stays owned by the ingest pipeline.
--
-- Apply as the curator role (or an admin) once:
--   psql "$WRITABLE_URL" -f sql/app_schema.sql

CREATE SCHEMA IF NOT EXISTS corpus_ai;

-- Every research question + how well it was grounded. This is the demand
-- signal that drives curation: low-groundedness questions are the editorial
-- backlog (topics the encyclopedia does not yet answer well).
CREATE TABLE IF NOT EXISTS corpus_ai.query_log (
  id               bigserial PRIMARY KEY,
  question         text NOT NULL,
  mode             text,            -- retrieval mode: 'index' | 'segment'
  grounding_mode   text,            -- 'verified' | 'extractive'
  claims_total     integer,
  claims_supported integer,
  groundedness     numeric(5,4),    -- supported / total (1 when no claims)
  segment_count    integer,
  indexes_followed text[],
  collection       text,
  author           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS query_log_created_idx ON corpus_ai.query_log (created_at DESC);
CREATE INDEX IF NOT EXISTS query_log_groundedness_idx ON corpus_ai.query_log (groundedness);
-- Trigram index for near-duplicate question detection (query dedup).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS query_log_question_trgm_idx
  ON corpus_ai.query_log USING gin (question gin_trgm_ops);

-- Point-in-time snapshots of the KB health metrics, so improvement is a
-- measurable delta across runs rather than a vibe.
CREATE TABLE IF NOT EXISTS corpus_ai.metric_snapshot (
  id          bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metrics     jsonb NOT NULL
);
