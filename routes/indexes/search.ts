import { define } from "../../utils.ts";
import { searchIndexes } from "../../lib/corpus/indexes.ts";
import { withApiErrors } from "../../lib/api-helpers.ts";

// GET /indexes/search?q=&limit=
//   -> { indexes: IndexNote[] }
export const handler = define.handlers({
  GET(ctx) {
    return withApiErrors(async () => {
      const url = new URL(ctx.req.url);
      const q = url.searchParams.get("q") ?? "";
      const limit = url.searchParams.get("limit");
      const indexes = await searchIndexes(q, limit ? parseInt(limit, 10) : 20);
      return Response.json({ indexes });
    });
  },
});
