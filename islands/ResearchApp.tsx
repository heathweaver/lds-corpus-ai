import { useState } from "preact/hooks";

// --- Client-side shapes (mirror lib/corpus/types.ts) ------------------------
interface Citation {
  segmentId: string;
  documentTitle: string | null;
  author: string | null;
  reference: string | null;
  sourceUrl: string | null;
  quote: string;
}
interface IndexNote {
  id: string;
  title: string;
  note: string | null;
  related?: { id: string; title: string }[];
  segmentIds?: string[];
}
interface Scope {
  mode: "index" | "segment";
  indexesFollowed: string[];
  segmentCount: number;
  collection?: string | null;
  author?: string | null;
}
interface Grounding {
  mode: "verified" | "extractive";
  claimsTotal: number;
  claimsSupported: number;
  claimsDropped: string[];
  score: number;
}
interface AskResult {
  answer: string;
  indexes: IndexNote[];
  citations: Citation[];
  scope: Scope;
  grounding: Grounding;
}
interface Segment {
  id: string;
  text: string;
  documentId: string | null;
  documentTitle: string | null;
  author: string | null;
  date: string | null;
  edition: string | null;
  sourceUrl: string | null;
  reference: string | null;
  collection: string | null;
  ordinal: number | null;
}
interface SegmentContext {
  segment: Segment;
  before: Segment[];
  after: Segment[];
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function sourceLine(
  s: {
    documentTitle: string | null;
    reference: string | null;
    author: string | null;
  },
) {
  return [s.documentTitle, s.reference].filter(Boolean).join(", ") +
    (s.author ? ` — ${s.author}` : "");
}

export default function ResearchApp() {
  const [question, setQuestion] = useState("");
  const [collection, setCollection] = useState("");
  const [author, setAuthor] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [index, setIndex] = useState<IndexNote | null>(null);
  const [source, setSource] = useState<SegmentContext | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function submitAsk(e: Event) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setIndex(null);
    setSource(null);
    try {
      const r = await getJson<AskResult>("/research/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          collection: collection || undefined,
          author: author || undefined,
        }),
      });
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function openIndex(id: string) {
    setError(null);
    try {
      setIndex(await getJson<IndexNote>(`/indexes/${encodeURIComponent(id)}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openSegment(id: string) {
    setError(null);
    try {
      setSource(
        await getJson<SegmentContext>(`/segments/${encodeURIComponent(id)}`),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyLink(segmentId: string) {
    const url = `${globalThis.location.origin}/segments/${
      encodeURIComponent(segmentId)
    }`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(segmentId);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div class="panes">
      {/* Pane 1: Ask */}
      <section class="pane pane-ask">
        <h2>Ask</h2>
        <form onSubmit={submitAsk} class="ask-form">
          <textarea
            value={question}
            onInput={(e) =>
              setQuestion((e.target as HTMLTextAreaElement).value)}
            placeholder="Ask a research question…"
            rows={3}
          />
          <div class="filters">
            <input
              value={collection}
              onInput={(e) =>
                setCollection((e.target as HTMLInputElement).value)}
              placeholder="Collection (optional)"
            />
            <input
              value={author}
              onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
              placeholder="Author (optional)"
            />
          </div>
          <button type="submit" disabled={asking}>
            {asking ? "Searching…" : "Ask"}
          </button>
        </form>

        {error && <p class="error">{error}</p>}

        {result && (
          <div class="answer">
            <div class="answer-text">{result.answer}</div>
            <div class={`grounding ${result.grounding.mode}`}>
              {result.grounding.mode === "verified"
                ? (
                  <>
                    ✓ Verified grounding: {result.grounding.claimsSupported}/
                    {result.grounding.claimsTotal} claims supported by sources
                    {result.grounding.claimsDropped.length > 0 && (
                      <span class="dropped">
                        {` · ${result.grounding.claimsDropped.length} unsupported statement(s) removed`}
                      </span>
                    )}
                  </>
                )
                : (
                  <>
                    Extractive answer — passages quoted directly from sources.
                  </>
                )}
            </div>
            <div class="scope">
              Retrieval: <strong>{result.scope.mode}</strong> ·{" "}
              {result.scope.segmentCount} segment(s)
              {result.scope.indexesFollowed.length > 0 &&
                <>· via {result.scope.indexesFollowed.join(", ")}</>}
            </div>
            {result.citations.length > 0 && (
              <div class="citations">
                <h3>Citations</h3>
                <ol>
                  {result.citations.map((c) => (
                    <li key={c.segmentId}>
                      <button
                        type="button"
                        class="link"
                        onClick={() => openSegment(c.segmentId)}
                      >
                        {sourceLine(c) || "source"}
                      </button>
                      <blockquote>
                        {c.quote.slice(0, 220)}
                        {c.quote.length > 220 ? "…" : ""}
                      </blockquote>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Pane 2: Indexes */}
      <section class="pane pane-indexes">
        <h2>Indexes</h2>
        {!result && (
          <p class="muted">Theme indexes that guided retrieval appear here.</p>
        )}
        {result && result.indexes.length === 0 && (
          <p class="muted">
            No theme indexes matched — searched sources directly.
          </p>
        )}
        {result && result.indexes.length > 0 && (
          <ul class="index-list">
            {result.indexes.map((idx) => (
              <li key={idx.id}>
                <button
                  type="button"
                  class="link"
                  onClick={() => openIndex(idx.id)}
                >
                  {idx.title}
                </button>
                {idx.note && (
                  <p class="muted small">{idx.note.slice(0, 120)}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {index && (
          <div class="index-detail">
            <h3>{index.title}</h3>
            {index.note && <p>{index.note}</p>}
            {index.related && index.related.length > 0 && (
              <>
                <h4>Related indexes</h4>
                <ul>
                  {index.related.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        class="link"
                        onClick={() => openIndex(r.id)}
                      >
                        {r.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {index.segmentIds && index.segmentIds.length > 0 && (
              <>
                <h4>Source material</h4>
                <ul>
                  {index.segmentIds.map((sid) => (
                    <li key={sid}>
                      <button
                        type="button"
                        class="link"
                        onClick={() => openSegment(sid)}
                      >
                        Segment {sid}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {/* Pane 3: Source */}
      <section class="pane pane-source">
        <h2>Source</h2>
        {!source && (
          <p class="muted">
            Select a citation or segment to read it in context.
          </p>
        )}
        {source && (
          <div class="source-reader">
            <div class="source-meta">
              <strong>{source.segment.documentTitle ?? "Untitled"}</strong>
              <div class="muted small">
                {[
                  source.segment.author,
                  source.segment.date,
                  source.segment.edition,
                ]
                  .filter(Boolean).join(" · ")}
                {source.segment.reference && <>· {source.segment.reference}</>}
              </div>
              <div class="source-actions">
                {source.segment.sourceUrl && (
                  <a
                    href={source.segment.sourceUrl}
                    target="_blank"
                    rel="noopener"
                  >
                    Source link ↗
                  </a>
                )}
                <button
                  type="button"
                  class="link"
                  onClick={() => copyLink(source.segment.id)}
                >
                  {copied === source.segment.id ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>
            <div class="passage">
              {source.before.map((s) => <p class="ctx" key={s.id}>{s.text}</p>)}
              <p class="cited" key={source.segment.id}>{source.segment.text}</p>
              {source.after.map((s) => <p class="ctx" key={s.id}>{s.text}</p>)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
