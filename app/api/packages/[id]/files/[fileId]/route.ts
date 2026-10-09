import { connection, type NextRequest } from "next/server";

import { fixtureFiles } from "@/lib/contract/fixtures";
import { FileUpdateBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { stubFileResponse } from "@/lib/server/stub-files";

// Stub (KTD3): replaced in U8.

type Context = RouteContext<"/api/packages/[id]/files/[fileId]">;

export async function GET(_request: NextRequest, context: Context) {
  await connection();

  const { fileId } = await context.params;

  return stubFileResponse(fileId);
}

export async function PATCH(request: NextRequest, context: Context) {
  return respond(async () => {
    const { fileId } = await context.params;
    const body = await readJson(request, FileUpdateBodySchema);
    const file = fixtureFiles.find((entry) => entry.id === fileId) ?? fixtureFiles[0];

    return Response.json({ ...file, excluded: body.excluded });
  });
}
