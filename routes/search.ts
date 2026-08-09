import { define } from "../utils.ts";
import { searchSegments } from "../lib/corpus/segments.ts";
import { withApiErrors } from "../lib/api-helpers.ts";

// GET /search?q=&collection=&author=&dateFrom=&dateTo=&limit=
//   -> { segments: Segment[], filters }
export const handler = define.handlers({
  GET(ctx) {
    return withApiErrors(async () => {
      const p = new URL(ctx.req.url).searchParams;
      const filters = {
        q: p.get("q") ?? undefined,
        collection: p.get("collection") ?? undefined,
        author: p.get("author") ?? undefined,
        dateFrom: p.get("dateFrom") ?? undefined,
        dateTo: p.get("dateTo") ?? undefined,
        limit: p.get("limit") ? parseInt(p.get("limit")!, 10) : undefined,
      };
      const segments = await searchSegments(filters);
      return Response.json({ segments, filters });
    });
  },
});
