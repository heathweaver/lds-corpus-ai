# Deploy

Target: **Deno Deploy**. The app builds a Fresh/Vite bundle and runs it with
`deno serve _fresh/server.js`. It connects to PostgreSQL (`ssc.pm:5433`,
database `lds_corpus`) through a **read-only** application role.

## 1. Create the read-only role (once)

The deployed app must not use `lds_corpus_ingest`. Create a least-privilege
role as a DB admin:

```bash
psql "postgresql://<admin>@ssc.pm:5433/lds_corpus?sslmode=require" \
  -v app_password="'choose-a-strong-password'" \
  -f sql/readonly_role.sql
```

This creates `lds_corpus_app` with `SELECT` on the `lds_corpus` schema (current
and future tables) and nothing else.

## 2. Create the Deno Deploy project

1. Create a project at <https://dash.deno.com> (note its name).
2. Set the project name in `.github/workflows/deploy.yml` (`project:`), replacing
   `lds-corpus-research`.
3. Authorize CI to deploy: either link this GitHub repo to the project (Git
   integration → enables the workflow's OIDC deploy), or create a
   `DENO_DEPLOY_TOKEN` and pass it to `deployctl`.

## 3. Set environment variables (project → Settings → Environment Variables)

Use the **read-only** role. Never commit these.

| Var | Value |
| --- | ----- |
| `PGHOST` | `ssc.pm` |
| `PGPORT` | `5433` |
| `PGDATABASE` | `lds_corpus` |
| `PGUSER` | `lds_corpus_app` |
| `PGPASSWORD` | *(the role password)* |
| `DB_SCHEMA` | `lds_corpus` |
| `PGSSLMODE` | `require` |
| `ANTHROPIC_API_KEY` | *(optional — enables Claude answer synthesis)* |
| `ANTHROPIC_MODEL` | *(optional — default `claude-sonnet-5`)* |

> **Network:** the deploy environment must be able to reach `ssc.pm:5433`.
> Without `ANTHROPIC_API_KEY`, `/research/ask` returns a grounded **extractive**
> answer (no external calls).

## 4. Deploy

Push to `main` — `.github/workflows/deploy.yml` builds and publishes. Or deploy
manually:

```bash
deno task build
deployctl deploy --project=<your-project> _fresh/server.js
```

## 5. Verify

- `GET /healthz` → `{"status":"ok","db":"configured"}`
- From an environment with DB access, confirm the schema mapping:

  ```bash
  deno task introspect
  ```

  This prints the resolved `v_segment_source` columns and theme-index relations.
- `GET /search?q=faith` should return segments; `POST /research/ask` a grounded
  answer.

## Local development

```bash
cp .env.example .env      # fill in PGUSER/PGPASSWORD (read-only role)
deno task dev             # Vite dev server with HMR
```

To exercise the full data path locally without the production DB, load the
schema and the sample seed into a local Postgres (needs the `vector` and
`pg_trgm` extensions):

```bash
psql "$LOCAL_URL" -f <lds_corpus schema.sql>
psql "$LOCAL_URL" -f sql/sample_seed.sql
```
