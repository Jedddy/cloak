import { connection, type NextRequest } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { respond } from "@/lib/server/http";
import { hasLiveJob } from "@/lib/server/jobs";
import { getPackageDetail } from "@/lib/server/packages";
import { deletePackage } from "@/lib/server/store";

type Context = RouteContext<"/api/packages/[id]">;

export async function GET(_request: NextRequest, context: Context) {
  await connection();

  return respond(async () => {
    const { id } = await context.params;

    return Response.json(await getPackageDetail(id));
  });
}

/** Removes all data of the package (overview section 17 item 8). */
export async function DELETE(_request: NextRequest, context: Context) {
  return respond(async () => {
    const { id } = await context.params;

    // A running job would write files into the folder again.
    if (hasLiveJob(id)) {
      throw new ApiError("conflict", "Wait for the scan or export to finish, then delete the package.");
    }

    await deletePackage(id);

    return Response.json({ ok: true });
  });
}
