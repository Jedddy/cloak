import type { NextRequest } from "next/server";

import { fixtureFindings, fixtureWarnings } from "@/lib/contract/fixtures";
import { FindingDecisionBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U11.

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/packages/[id]/findings/[findingId]">,
) {
  return respond(async () => {
    const { findingId } = await context.params;
    const body = await readJson(request, FindingDecisionBodySchema);
    const finding = fixtureFindings.find((entry) => entry.id === findingId) ?? fixtureFindings[0];

    return Response.json({
      findings: [{ ...finding, decision: body.decision }],
      warnings: fixtureWarnings,
    });
  });
}
