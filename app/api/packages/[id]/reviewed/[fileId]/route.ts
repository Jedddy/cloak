import { connection, type NextRequest } from "next/server";

import { reviewedName } from "@/lib/server/export";
import { fileResponse, respond } from "@/lib/server/http";
import { findFile } from "@/lib/server/packages";
import { workspacePaths } from "@/lib/server/paths";
import { readPackage } from "@/lib/server/store";

/** Streams the reviewed copy of a file, for the before/after preview. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/packages/[id]/reviewed/[fileId]">) {
  await connection();

  return respond(async () => {
    const { id, fileId } = await context.params;
    const file = findFile(await readPackage(id), fileId);
    const name = await reviewedName(id, fileId);

    return fileResponse(workspacePaths.reviewed(id, name), file.mime);
  });
}
