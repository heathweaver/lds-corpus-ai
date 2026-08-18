import type postgres from "postgres";

/**
 * Pluggable embedding providers for query-side semantic search.
 *
 * The corpus segments are embedded by the ingest pipeline and stored in
 * `lds_corpus.embedding` (object_type='segment', with model + dimensions).
 * For semantic search we must embed the QUERY with the SAME model so the
 * vectors are comparable. `discoverCorpusEmbedding()` reports what the ingest
 * used; `getEmbedProvider()` returns a matching client when configured, else
 * null (search degrades to keyword FTS).
 *
 * Configure with EMBED_PROVIDER=voyage|openai and the provider's API key.
 */

export interface EmbedProvider {
  name: string;
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface CorpusEmbeddingInfo {
  model: string;
  dimensions: number;
  count: number;
}

/** What model/dimensions the corpus segments were embedded with (if any). */
export async function discoverCorpusEmbedding(
  sql: postgres.Sql,
): Promise<CorpusEmbeddingInfo | null> {
  const rows = await sql<{ model: string; dimensions: number; n: number }[]>`
    SELECT model, dimensions, count(*)::int AS n
    FROM embedding
    WHERE object_type = 'segment'
    GROUP BY model, dimensions
    ORDER BY n DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    model: rows[0].model,
    dimensions: rows[0].dimensions,
    count: rows[0].n,
  };
}

function env(k: string): string | undefined {
  const v = Deno.env.get(k);
  return v && v.length > 0 ? v : undefined;
}

async function postEmbeddings(
  url: string,
  apiKey: string,
  model: string,
  texts: string[],
  extra: Record<string, unknown> = {},
): Promise<number[][]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts, ...extra }),
  });
  if (!res.ok) {
    throw new Error(
      `Embedding request failed (${res.status}): ${await res.text()}`,
    );
  }
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

function voyageProvider(): EmbedProvider | null {
  const apiKey = env("VOYAGE_API_KEY");
  if (!apiKey) return null;
  const model = env("VOYAGE_MODEL") ?? "voyage-3";
  return {
    name: "voyage",
    model,
    embed: (texts) =>
      postEmbeddings(
        "https://api.voyageai.com/v1/embeddings",
        apiKey,
        model,
        texts,
        {
          input_type: "query",
        },
      ),
  };
}

function openaiProvider(): EmbedProvider | null {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;
  const model = env("OPENAI_EMBED_MODEL") ?? "text-embedding-3-small";
  return {
    name: "openai",
    model,
    embed: (texts) =>
      postEmbeddings(
        "https://api.openai.com/v1/embeddings",
        apiKey,
        model,
        texts,
      ),
  };
}

/** The configured embedding provider, or null when none is set up. */
export function getEmbedProvider(): EmbedProvider | null {
  switch ((env("EMBED_PROVIDER") ?? "").toLowerCase()) {
    case "voyage":
      return voyageProvider();
    case "openai":
      return openaiProvider();
    default:
      return null;
  }
}
