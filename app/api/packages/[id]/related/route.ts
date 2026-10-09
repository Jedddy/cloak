import { fixtureRelatedResult } from "@/lib/contract/fixtures";
import { RelatedBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U11.

export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, RelatedBodySchema);

    return Response.json({ ...fixtureRelatedResult, term: body.term });
  });
}
