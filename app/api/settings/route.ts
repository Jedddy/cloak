import { connection } from "next/server";

import { SettingsUpdateBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { readSettingsResponse, saveSettings } from "@/lib/server/settings";

export async function GET() {
  await connection();

  return respond(async () => Response.json(await readSettingsResponse()));
}

export async function PUT(request: Request) {
  return respond(async () => {
    const body = await readJson(request, SettingsUpdateBodySchema);

    return Response.json(await saveSettings(body));
  });
}
