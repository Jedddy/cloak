import { connection, type NextRequest } from "next/server";

import { stubFileResponse } from "@/lib/server/stub-files";

// Stub (KTD3): replaced in U12.

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/packages/[id]/reviewed/[fileId]">,
) {
  await connection();

  const { fileId } = await context.params;

  return stubFileResponse(fileId);
}
