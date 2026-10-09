import { connection } from "next/server";

import { RecipientUpsertBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { readRecipients, saveRecipient } from "@/lib/server/store";

export async function GET() {
  await connection();

  return respond(async () => Response.json(await readRecipients()));
}

/** No id creates a recipient; an id updates its name and profile. Allow rules stay. */
export async function POST(request: Request) {
  return respond(async () => {
    const body = await readJson(request, RecipientUpsertBodySchema);

    return Response.json(await saveRecipient(body));
  });
}
