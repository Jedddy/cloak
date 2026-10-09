import { readFile } from "node:fs/promises";

import { connection } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { documentFormat } from "@/lib/contract/schemas";
import { reviewedName } from "@/lib/server/export";
import { respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { findFile } from "@/lib/server/packages";
import { workspacePaths } from "@/lib/server/paths";
import { readPackage } from "@/lib/server/store";

/** The document model of the reviewed copy, extracted on each request. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/packages/[id]/reviewed/[fileId]/document">,
) {
  await connection();

  return respond(async () => {
    const { id, fileId } = await context.params;
    const file = findFile(await readPackage(id), fileId);
    const format = documentFormat(file.mime);

    if (format === null) {
      throw new ApiError("not-found", "This file is not a document.");
    }

    const name = await reviewedName(id, fileId);
    const bytes = new Uint8Array(await readFile(workspacePaths.reviewed(id, name)));

    return Response.json(await layers.document.extract({ fileName: name, format, bytes }));
  });
}
