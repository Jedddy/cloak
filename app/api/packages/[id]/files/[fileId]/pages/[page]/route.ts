import { connection } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { pdfPageParam, pngResponse, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { findFile } from "@/lib/server/packages";
import { readOriginal, readPackage, readPageRender, writePageRender } from "@/lib/server/store";

/** A PNG render of one PDF page (1-based), cached in derived/. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/packages/[id]/files/[fileId]/pages/[page]">,
) {
  await connection();

  return respond(async () => {
    const { id, fileId, page: pageParam } = await context.params;
    const file = findFile(await readPackage(id), fileId);
    const page = pdfPageParam(file, pageParam);

    let png = await readPageRender(id, fileId, page);

    if (png === null) {
      png = await layers.document.renderPage({ bytes: await readOriginal(id, file), page }).catch(() => {
        throw new ApiError("not-found", "No such page.");
      });

      await writePageRender(id, fileId, page, png);
    }

    return pngResponse(png);
  });
}
