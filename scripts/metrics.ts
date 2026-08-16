#!/usr/bin/env -S deno run -A
import "../lib/env/load.ts";
import { parseArgs } from "@std/cli/parse-args";
import { closePool } from "../lib/db/postgres-base.ts";
import { closeAppPool } from "../lib/db/app-writable.ts";
import { computeMetrics, snapshotMetrics } from "../lib/metrics/metrics.ts";

/**
 * Print knowledge-base health metrics.
 *
 *   deno task metrics              # print current metrics
 *   deno task metrics -- --snapshot   # also persist a corpus_ai.metric_snapshot
 *
 * --snapshot requires the writable app connection (APP_PG* / APP_DATABASE_URL).
 */

const args = parseArgs(Deno.args, { boolean: ["snapshot"] });
const metrics = args.snapshot
  ? await snapshotMetrics()
  : await computeMetrics();
console.log(JSON.stringify(metrics, null, 2));

await closeAppPool();
await closePool();
