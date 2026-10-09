import { connection } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { respond } from "@/lib/server/http";
import { findFile } from "@/lib/server/packages";
import { readDocument, readPackage } from "@/lib/server/store";

/** The cached document model for the viewer: text, sections with offsets, words, pages, hidden items. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/packages/[id]/files/[fileId]/document">,
) {
  await connection();

  return respond(async () => {
    const { id, fileId } = await context.params;
    const file = findFile(await readPackage(id), fileId);

    if (file.kind !== "document") {
      throw new ApiError("not-found", "This file is not a document.");
    }

    const model = await readDocument(id, fileId);

    if (model === null) {
      throw new ApiError("conflict", "Scan the package to see this document.");
    }

    return Response.json(model);
  });
}
