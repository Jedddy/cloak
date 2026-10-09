import { ScanStartBodySchema, type JobStartResponse } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";
import { startScan } from "@/lib/server/pipeline";

/** Starts a scan job; the browser polls the job route for progress. */
export async function POST(request: Request, context: RouteContext<"/api/packages/[id]/scan">) {
  return respond(async () => {
    const { id } = await context.params;
    const body = await readJson(request, ScanStartBodySchema);
    const job = await startScan(id, body, layers);
    const response: JobStartResponse = { jobId: job.id };

    return Response.json(response);
  });
}
