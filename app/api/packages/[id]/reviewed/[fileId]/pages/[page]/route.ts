import { readFile } from "node:fs/promises";

import { connection } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { reviewedName } from "@/lib/server/export";
import { pdfPageParam, pngResponse, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { findFile } from "@/lib/server/packages";
import { workspacePaths } from "@/lib/server/paths";
import { readPackage } from "@/lib/server/store";

/** A PNG render of one page (1-based) of the reviewed PDF, made on each request. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/packages/[id]/reviewed/[fileId]/pages/[page]">,
) {
  await connection();

  return respond(async () => {
    const { id, fileId, page: pageParam } = await context.params;
    const file = findFile(await readPackage(id), fileId);
    const page = pdfPageParam(file, pageParam);

    const name = await reviewedName(id, fileId);
    const bytes = new Uint8Array(await readFile(workspacePaths.reviewed(id, name)));

    const png = await layers.document.renderPage({ bytes, page }).catch(() => {
      throw new ApiError("not-found", "No such page.");
    });

    return pngResponse(png);
  });
}
