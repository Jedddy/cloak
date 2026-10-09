import { FindingDecisionBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { decideFinding } from "@/lib/server/review";

/** Saves a decision at once and returns the changed findings and current warnings. */
export async function PATCH(request: Request, context: RouteContext<"/api/packages/[id]/findings/[findingId]">) {
  return respond(async () => {
    const { id, findingId } = await context.params;
    const body = await readJson(request, FindingDecisionBodySchema);

    return Response.json(await decideFinding(id, findingId, body, layers));
  });
}
