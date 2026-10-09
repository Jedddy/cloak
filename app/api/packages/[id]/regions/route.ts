import { RegionBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { saveRegion } from "@/lib/server/review";

/** Adds, moves, or deletes a manual region (M12). */
export async function POST(request: Request, context: RouteContext<"/api/packages/[id]/regions">) {
  return respond(async () => {
    const { id } = await context.params;
    const body = await readJson(request, RegionBodySchema);

    return Response.json(await saveRegion(id, body, layers));
  });
}
