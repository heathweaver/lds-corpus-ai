import { define } from "../../utils.ts";
import { getIndex } from "../../lib/corpus/indexes.ts";
import { notFound, withApiErrors } from "../../lib/api-helpers.ts";

// GET /indexes/:id
//   -> IndexNote (with related indexes + linked segment ids)
export const handler = define.handlers({
  GET(ctx) {
    return withApiErrors(async () => {
      const index = await getIndex(ctx.params.id);
      if (!index) return notFound(`Index ${ctx.params.id} not found.`);
      return Response.json(index);
    });
  },
});
