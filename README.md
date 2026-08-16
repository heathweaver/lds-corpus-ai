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
| GET | `/healthz` | Liveness + DB/MCP-config probe |
| GET | `/metrics` | KB health: coverage / faithfulness / freshness / demand |
| POST | `/mcp` | MCP (JSON-RPC) research endpoint for AI runtimes — see below |

## Architecture

- **`lib/db/postgres-base.ts`** — single pooled, **read-only** `postgres`
  connection (TLS required, `search_path` pinned to `lds_corpus`). Created
  lazily so the server boots even without credentials.
- **`lib/corpus/`** — the domain layer over the real schema:
  - `segments.ts` — queries `v_segment_source`, enriched with columns the view
    doesn't expose: **author** (`contribution → agent.preferred_name`),
    **edition** (`document.edition_label`), **source link** (first entry of the
    view's `sources` jsonb), **ordering** (`content_node.sequence`). Full-text
    search uses the indexed `segment.search_vector` with `ts_rank_cd`;
    surrounding context follows the `segment.previous/next_segment_id` chain.
  - `indexes.ts` — theme indexes via `theme_index → theme_index_version →
    index_section → index_paragraph → support_link → segment`; "related"
    indexes are computed from overlapping supporting segments.
  - `retrieval.ts` (the ask flow), `answer.ts` (Claude synthesis + extractive
    fallback), `types.ts`.
- **`lib/db/corpus-introspect.ts`** — powers `deno task introspect`, which
  prints the live `v_segment_source` columns and theme-index relations.
- **`routes/`** — Fresh file-system routes; API handlers return JSON, `_app.tsx`
  + `islands/ResearchApp.tsx` render the three-pane UI.

Answer synthesis mirrors twiglit-notes' `lib/consolidate/claude.ts`: forced
tool-use with a cached system block. With no `ANTHROPIC_API_KEY`, answers are
extractive (top segments stitched with citations) — no external calls.

## Grounding — not letting the AI invent connections

Faithfulness is enforced by **separating generation from verification**
(`lib/grounding/`):

- **`verify.ts`** — an independent, skeptical pass judges a single claim
  against a single source span (`supported` / `partial` / `unsupported`) and
  must quote the supporting words. It **fails closed**: uncertainty ⇒
  unsupported, and any "supported" verdict whose quote is not verbatim in the
  source is downgraded. The writer never grades its own work.
- **`/research/ask`** generates atomic, individually-cited claims, verifies
  each, and **drops the unsupported ones** — the response carries a
  `GroundingReport` (supported/total, dropped count) and only verified
  citations.
- **Theme creation** (`lib/themes/create.ts`) generates sections/paragraphs,
  verifies each paragraph against its cited segments, and persists **only
  verified** paragraphs as `support_link`s (`verifier_status='verified'`,
  `support_strength` from the verifier, located source offsets). Themes are
  written `draft` / `generated` — never auto-published.

  ```bash
  deno task theme -- --title "Faith and Belief" \
    --question "How is faith described as a principle of action?" \
    --collection "Book of Mormon"          # dry run; add --persist to write
  ```

## Retrieval — hybrid (keyword + semantic)

`lib/retrieval/hybrid.ts` fuses keyword FTS with pgvector nearest-neighbour
search via **Reciprocal Rank Fusion (RRF)**. The query is embedded with the
same model the corpus was embedded with (discovered from the `embedding`
table); with no `EMBED_PROVIDER` configured it degrades to keyword-only. Used
by `/research/ask` and by theme candidate retrieval.

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

- A guarded **theme review/publish** endpoint + UI (promote `draft` →
  `published`).
- Optional **Twiglit twig consumption** (OAuth PKCE client) — "research this
  twig" / "save a cited passage into a twig".
- Topic graphs, annotations, saved workspaces.

## Running inside Twiglit

This app can run as a **Twiglit extension** (like `twiglit-notes`/loam): its UI
gates to logged-in Twiglit users and it's registered in Twiglit's plugin
catalog. Set `TWIGLIT_APP_URL` to turn on the session gate; see
[docs/twiglit-integration.md](docs/twiglit-integration.md) and the ready-to-PR
files in [`twiglit-plugin/`](twiglit-plugin/).

The **Twiglit runtime (its AI) researches the corpus via `POST /mcp`** — a
JSON-RPC MCP endpoint exposing the same verified tools (`research_ask`,
`generate_theme`, `search_corpus`, …), authenticated with a service token
(`MCP_SERVICE_TOKEN`). So both a human researcher (the three-pane UI) and the
runtime hit the same grounded core.
