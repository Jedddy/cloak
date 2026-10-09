import { fixtureFindings, fixtureWarnings } from "@/lib/contract/fixtures";
import { RegionBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U11.

export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, RegionBodySchema);
    const manual = fixtureFindings.find((finding) => finding.id === "fnd-shot1-manual");

    if (body.action === "delete" || manual === undefined) {
      return Response.json({ findings: [], warnings: fixtureWarnings });
    }

    return Response.json({ findings: [manual], warnings: fixtureWarnings });
  });
}
