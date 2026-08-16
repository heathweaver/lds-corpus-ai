import { getSql } from "../db/postgres-base.ts";
import { getAppSql } from "../db/app-writable.ts";

/**
 * KB health metrics — the three quantities that define a grounded encyclopedia
 * over a closed corpus: coverage, faithfulness, freshness (+ demand fit from
 * the query log). Corpus metrics come from the read-only connection; demand
 * metrics from the optional writable app connection (null when unconfigured).
 */

export interface KbMetrics {
  coverage: {
    segmentsTotal: number;
    segmentsCited: number;
    /** Fraction of source segments cited by at least one theme paragraph. */
    segmentCoverage: number;
    themesTotal: number;
    themesPublished: number;
    themesDraft: number;
  };
  faithfulness: {
    supportLinks: number;
    verifiedLinks: number;
    /** Fraction of support links whose verifier_status = 'verified'. */
    verifiedRatio: number;
    avgSupportStrength: number;
  };
  freshness: {
    unverifiedLinks: number;
    latestThemeUpdate: string | null;
  };
  demand: null | {
    questions: number;
    avgGroundedness: number;
    /** Questions grounded below 0.5 — the editorial backlog. */
    lowGroundedness: number;
    indexModeShare: number;
  };
}

function ratio(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;
}

export async function computeMetrics(): Promise<KbMetrics> {
  const sql = getSql();

  const [seg] = await sql<
    { total: number }[]
  >`SELECT count(*)::int AS total FROM segment`;
  const [cited] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT segment_id)::int AS n FROM support_link`;
  const [themes] = await sql<
    { total: number; published: number; draft: number }[]
  >`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'published')::int AS published,
           count(*) FILTER (WHERE status = 'draft')::int AS draft
    FROM theme_index`;
  const [links] = await sql<
    {
      total: number;
      verified: number;
      avg_strength: number;
      unverified: number;
    }[]
  >`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE verifier_status = 'verified')::int AS verified,
           COALESCE(avg(support_strength), 0)::float8 AS avg_strength,
           count(*) FILTER (WHERE verifier_status <> 'verified')::int AS unverified
    FROM support_link`;
  const [fresh] = await sql<{ latest: string | null }[]>`
    SELECT max(updated_at)::text AS latest FROM theme_index`;

  let demand: KbMetrics["demand"] = null;
  const appSql = getAppSql();
  if (appSql) {
    try {
      const [d] = await appSql<
        { questions: number; avg_g: number; low: number; index_mode: number }[]
      >`
        SELECT count(*)::int AS questions,
               COALESCE(avg(groundedness), 0)::float8 AS avg_g,
               count(*) FILTER (WHERE groundedness < 0.5)::int AS low,
               count(*) FILTER (WHERE mode = 'index')::int AS index_mode
        FROM corpus_ai.query_log`;
      demand = {
        questions: d.questions,
        avgGroundedness: Math.round(d.avg_g * 10000) / 10000,
        lowGroundedness: d.low,
        indexModeShare: ratio(d.index_mode, d.questions),
      };
    } catch (err) {
      console.error("[metrics] demand metrics failed:", err);
    }
  }

  return {
    coverage: {
      segmentsTotal: seg.total,
      segmentsCited: cited.n,
      segmentCoverage: ratio(cited.n, seg.total),
      themesTotal: themes.total,
      themesPublished: themes.published,
      themesDraft: themes.draft,
    },
    faithfulness: {
      supportLinks: links.total,
      verifiedLinks: links.verified,
      verifiedRatio: ratio(links.verified, links.total),
      avgSupportStrength: Math.round(links.avg_strength * 10000) / 10000,
    },
    freshness: {
      unverifiedLinks: links.unverified,
      latestThemeUpdate: fresh.latest,
    },
    demand,
  };
}

/** Persist a metric snapshot (requires the writable connection). */
export async function snapshotMetrics(): Promise<KbMetrics> {
  const metrics = await computeMetrics();
  const appSql = getAppSql();
  if (appSql) {
    await appSql`
      INSERT INTO corpus_ai.metric_snapshot (metrics) VALUES (${
      appSql.json(metrics as never)
    })`;
  }
  return metrics;
}
