import { define } from "../utils.ts";
import { computeMetrics } from "../lib/metrics/metrics.ts";
import { withApiErrors } from "../lib/api-helpers.ts";

// GET /metrics — KB health (coverage / faithfulness / freshness / demand).
// Behind the Twiglit session gate when configured (operational/admin view).
export const handler = define.handlers({
  GET() {
    return withApiErrors(async () => Response.json(await computeMetrics()));
  },
});
