import { connection } from "next/server";

import { fixtureProfiles } from "@/lib/contract/fixtures";
import { ProfileUpsertBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U7.

export async function GET() {
  await connection();

  return Response.json(fixtureProfiles);
}

export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, ProfileUpsertBodySchema);

    return Response.json({ ...body, id: body.id ?? "profile-stub" });
  });
}
