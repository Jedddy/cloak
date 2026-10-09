import { connection, type NextRequest } from "next/server";

import type { OcrResult } from "@/lib/contract/schemas";
import { respond } from "@/lib/server/http";
import { findFile } from "@/lib/server/packages";
import { readOcr, readPackage } from "@/lib/server/store";

/** OCR words for the viewer; empty until a scan has read the image. */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/packages/[id]/files/[fileId]/ocr">,
) {
  await connection();

  return respond(async () => {
    const { id, fileId } = await context.params;

    findFile(await readPackage(id), fileId);

    const empty: OcrResult = { words: [], lowConfidence: false };

    return Response.json((await readOcr(id, fileId)) ?? empty);
  });
}
