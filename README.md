# LDS Corpus Research UI

A minimal research front end over a PostgreSQL corpus of Latter-day Saint
scripture and early LDS historical texts. Ask a natural-language question, see
which Zettelkasten-style **theme indexes** guided retrieval, and inspect the
original source segments in context.

Built with **Fresh 2 + Vite** on Deno, backed by Postgres through a read-only
application role. Conventions are mirrored from
[`heathweaver/twiglit-notes`](https://github.com/heathweaver/twiglit-notes).

## Retrieval flow

```
Question → theme indexes → relevant segments → grounded answer
```

Theme indexes guide the AI toward likely material; the actual segment text is
then read before answering. Until theme indexes are populated, the system
searches `lds_corpus.v_segment_source` directly.

## Three-pane screen

1. **Ask** — question box + short grounded answer with passage-level citations.
2. **Indexes** — the theme indexes used; click one to see related indexes and
   the source material it points toward.
3. **Source** — opens the cited segment in surrounding context, with document
   title, author, date, edition, and source link. Copy or link to a passage.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/research/ask` | Grounded answer → `{ answer, indexes, citations, scope }` |
| GET | `/indexes/search?q=` | Search theme indexes |
| GET | `/indexes/:id` | One index + related indexes + linked segment ids |
| GET | `/segments/:id?window=` | A segment in surrounding context |
| GET | `/documents/:id` | Document metadata + ordered segments |
| GET | `/search?q=&collection=&author=&dateFrom=&dateTo=` | Faceted segment search |
| GET | `/healthz` | Liveness + DB-config probe |

## Architecture

- **`lib/db/postgres-base.ts`** — single pooled, **read-only** `postgres`
  connection (TLS required, `search_path` pinned to `lds_corpus`). Created
  lazily so the server boots even without credentials.
- **`lib/db/corpus-introspect.ts`** — resolves the real column names of
  `v_segment_source` (and theme-index relations) at runtime by candidate list,
  so the app is correct across small schema variations. `deno task introspect`
  prints what it sees.
- **`lib/corpus/`** — the domain layer: `segments.ts`, `indexes.ts`,
  `retrieval.ts` (the ask flow), `answer.ts` (Claude synthesis with an
  extractive fallback), `types.ts`.
- **`routes/`** — Fresh file-system routes; API handlers return JSON, `_app.tsx`
  + `islands/ResearchApp.tsx` render the three-pane UI.

Answer synthesis mirrors twiglit-notes' `lib/consolidate/claude.ts`: forced
tool-use with a cached system block. With no `ANTHROPIC_API_KEY`, answers are
extractive (top segments stitched with citations) — no external calls.

## Setup

1. **Create the read-only role** (once, as a DB admin):

   ```bash
   psql "postgresql://<admin>@ssc.pm:5433/lds_corpus?sslmode=require" \
     -v app_password="'strong-password'" -f sql/readonly_role.sql
   ```

2. **Configure env** — copy `.env.example` to `.env` and fill in `PGUSER`
   (`lds_corpus_app`) and `PGPASSWORD`. Optionally set `ANTHROPIC_API_KEY` for
   LLM answer synthesis.

3. **Confirm the schema mapping**:

   ```bash
   deno task introspect
   ```

   If any logical field is unresolved, add the real column name to the
   candidate lists in `lib/db/corpus-introspect.ts`.

## Run

```bash
deno task dev      # Vite dev server with HMR
deno task build    # production build → _fresh/
deno task start    # serve the build
deno task check    # fmt + lint + type-check
```

## Roadmap

The v1 spec defers these; the code is structured to slot them in:

- **MCP server** (`mcp/`) exposing the corpus (patterned on twiglit-notes'
  Streamable-HTTP MCP with a read-only Postgres backend).
- **Theme creation** — Claude-driven generation of the Zettelkasten theme
  indexes over segments.
- Topic graphs, annotations, saved workspaces.
