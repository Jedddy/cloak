import { RelatedBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { findRelated } from "@/lib/server/review";

/** Finds related occurrences of a term across the package's files (M13). */
export async function POST(request: Request, context: RouteContext<"/api/packages/[id]/related">) {
  return respond(async () => {
    const { id } = await context.params;
    const body = await readJson(request, RelatedBodySchema);

    return Response.json(await findRelated(id, body, layers));
  });
}
