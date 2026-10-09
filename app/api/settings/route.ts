import { connection } from "next/server";

import { fixtureSettingsResponse } from "@/lib/contract/fixtures";
import { SettingsUpdateBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U7.

export async function GET() {
  await connection();

  return Response.json(fixtureSettingsResponse);
}

export async function PUT(request: Request) {
  return respond(async () => {
    const body = await readJson(request, SettingsUpdateBodySchema);

    return Response.json({ ...fixtureSettingsResponse, ...body });
  });
}
