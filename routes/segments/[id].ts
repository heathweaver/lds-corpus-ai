import { define } from "../../utils.ts";
import { getSegmentContext } from "../../lib/corpus/segments.ts";
import { notFound, withApiErrors } from "../../lib/api-helpers.ts";

// GET /segments/:id?window=
//   -> SegmentContext { segment, before[], after[] }
export const handler = define.handlers({
  GET(ctx) {
    return withApiErrors(async () => {
      const url = new URL(ctx.req.url);
      const window = url.searchParams.get("window");
      const ctxResult = await getSegmentContext(
        ctx.params.id,
        window ? parseInt(window, 10) : 3,
      );
      if (!ctxResult) return notFound(`Segment ${ctx.params.id} not found.`);
      return Response.json(ctxResult);
    });
  },
});
