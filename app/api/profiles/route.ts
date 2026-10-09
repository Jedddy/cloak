import { connection } from "next/server";

import { ProfileUpsertBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { readProfiles, saveProfile } from "@/lib/server/store";

export async function GET() {
  await connection();

  return respond(async () => Response.json(await readProfiles()));
}

/** No id creates a profile; an id updates that profile. */
export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, ProfileUpsertBodySchema);

    return Response.json(await saveProfile(body));
  });
}
