import { define } from "../../utils.ts";
import { getDocument } from "../../lib/corpus/segments.ts";
import { notFound, withApiErrors } from "../../lib/api-helpers.ts";

// GET /documents/:id?limit=
//   -> DocumentDetail { id, title, author, date, edition, collection, segments[] }
export const handler = define.handlers({
  GET(ctx) {
    return withApiErrors(async () => {
      const url = new URL(ctx.req.url);
      const limit = url.searchParams.get("limit");
      const doc = await getDocument(
        ctx.params.id,
        limit ? parseInt(limit, 10) : 1000,
      );
      if (!doc) return notFound(`Document ${ctx.params.id} not found.`);
      return Response.json(doc);
    });
  },
});
