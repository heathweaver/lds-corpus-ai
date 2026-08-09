import { define } from "../../utils.ts";
import { ask } from "../../lib/corpus/retrieval.ts";
import { badRequest, withApiErrors } from "../../lib/api-helpers.ts";

// POST /research/ask
//   body: { question: string, collection?: string, author?: string }
//   ->   { answer, indexes, citations, scope }
export const handler = define.handlers({
  POST(ctx) {
    return withApiErrors(async () => {
      const body = await ctx.req.json().catch(() => null) as
        | { question?: string; collection?: string; author?: string }
        | null;
      const question = body?.question?.trim();
      if (!question) return badRequest("`question` is required.");
      const result = await ask({
        question,
        collection: body?.collection?.trim() || undefined,
        author: body?.author?.trim() || undefined,
      });
      return Response.json(result);
    });
  },
});
