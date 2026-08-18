-- Read-only application role for the deployed research app.
--
-- Run this ONCE as a privileged user (an admin/owner of the lds_corpus
-- database). The deployed app connects as this role and can only SELECT.
-- Do NOT deploy the app with lds_corpus_ingest or any writable role.
--
--   psql "postgresql://<admin>@ssc.pm:5433/lds_corpus?sslmode=require" \
--        -v app_password="'choose-a-strong-password'" \
--        -f sql/readonly_role.sql
--
-- Then put the same password in the app's env as PGPASSWORD (PGUSER=lds_corpus_app).

\set app_user lds_corpus_app

-- 1) Create the login role (no-op if it already exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lds_corpus_app') THEN
    EXECUTE format('CREATE ROLE lds_corpus_app LOGIN PASSWORD %L', :'app_password');
  ELSE
    EXECUTE format('ALTER ROLE lds_corpus_app LOGIN PASSWORD %L', :'app_password');
  END IF;
END
$$;

-- Belt-and-suspenders: this role must never write.
ALTER ROLE lds_corpus_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- 2) Connect + schema usage.
GRANT CONNECT ON DATABASE lds_corpus TO lds_corpus_app;
GRANT USAGE ON SCHEMA lds_corpus TO lds_corpus_app;

-- 3) SELECT on everything that exists now (tables + views).
GRANT SELECT ON ALL TABLES IN SCHEMA lds_corpus TO lds_corpus_app;

-- 4) SELECT on anything the ingest pipeline creates later.
ALTER DEFAULT PRIVILEGES IN SCHEMA lds_corpus
  GRANT SELECT ON TABLES TO lds_corpus_app;

-- 5) Explicitly ensure no write privileges linger.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA lds_corpus
  FROM lds_corpus_app;
