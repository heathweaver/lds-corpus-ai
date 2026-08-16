-- Least-privilege WRITABLE role for internal curation jobs (theme generation /
-- improvement) and demand logging. This role is used ONLY by internal jobs and
-- the app's optional writable connection — never by the public consumer app,
-- which stays on the read-only lds_corpus_app role.
--
-- It can: read all of lds_corpus; write ONLY the knowledge-base tables
-- (theme_index and descendants + support_link); own everything in corpus_ai.
-- It cannot touch the source corpus tables (segment, document, work, …).
--
--   psql "postgresql://<admin>@ssc.pm:5433/lds_corpus?sslmode=require" \
--        -v curator_password="'choose-a-strong-password'" \
--        -f sql/curator_role.sql
-- (run sql/app_schema.sql first, or as the same admin, so corpus_ai exists)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lds_corpus_curator') THEN
    EXECUTE format('CREATE ROLE lds_corpus_curator LOGIN PASSWORD %L', :'curator_password');
  ELSE
    EXECUTE format('ALTER ROLE lds_corpus_curator LOGIN PASSWORD %L', :'curator_password');
  END IF;
END
$$;
ALTER ROLE lds_corpus_curator NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE lds_corpus TO lds_corpus_curator;

-- Read the whole corpus (needed to ground and verify).
GRANT USAGE ON SCHEMA lds_corpus TO lds_corpus_curator;
GRANT SELECT ON ALL TABLES IN SCHEMA lds_corpus TO lds_corpus_curator;
ALTER DEFAULT PRIVILEGES IN SCHEMA lds_corpus
  GRANT SELECT ON TABLES TO lds_corpus_curator;

-- Write ONLY the knowledge-base (encyclopedia) tables.
GRANT INSERT, UPDATE, DELETE ON
  lds_corpus.theme_index,
  lds_corpus.theme_index_version,
  lds_corpus.index_section,
  lds_corpus.index_paragraph,
  lds_corpus.support_link
  TO lds_corpus_curator;

-- Operational schema is fully owned by the curator.
GRANT USAGE, CREATE ON SCHEMA corpus_ai TO lds_corpus_curator;
GRANT ALL ON ALL TABLES IN SCHEMA corpus_ai TO lds_corpus_curator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA corpus_ai TO lds_corpus_curator;
ALTER DEFAULT PRIVILEGES IN SCHEMA corpus_ai GRANT ALL ON TABLES TO lds_corpus_curator;
ALTER DEFAULT PRIVILEGES IN SCHEMA corpus_ai GRANT ALL ON SEQUENCES TO lds_corpus_curator;
