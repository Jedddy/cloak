import { connection, type NextRequest } from "next/server";

import { ApiError } from "@/lib/contract/errors";
import { respond } from "@/lib/server/http";
import { getJob } from "@/lib/server/jobs";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/packages/[id]/jobs/[jobId]">,
) {
  await connection();

  return respond(async () => {
    const { id, jobId } = await context.params;
    const job = getJob(jobId);

    if (job === null || job.packageId !== id) {
      throw new ApiError("not-found", "No job with this id. A server restart ends running jobs.");
    }

    return Response.json(job);
  });
}
