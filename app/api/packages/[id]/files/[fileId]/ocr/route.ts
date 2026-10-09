import { connection, type NextRequest } from "next/server";

import { fixtureFiles, fixtureOcrByFileName } from "@/lib/contract/fixtures";

// Stub (KTD3): replaced in U8.

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/packages/[id]/files/[fileId]/ocr">,
) {
  await connection();

  const { fileId } = await context.params;
  const file = fixtureFiles.find((entry) => entry.id === fileId);
  const ocr = fixtureOcrByFileName.get(file?.originalName ?? "");

  return Response.json(ocr ?? { words: [], lowConfidence: false });
}
