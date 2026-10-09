import { connection, type NextRequest } from "next/server";

import { buildZip } from "@/lib/server/export";
import { respond } from "@/lib/server/http";

/** Downloads the reviewed copies of the last export. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/packages/[id]/export.zip">) {
  await connection();

  return respond(async () => {
    const { id } = await context.params;

    return new Response(await buildZip(id), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="reviewed.zip"',
        "Cache-Control": "no-store",
      },
    });
  });
}
