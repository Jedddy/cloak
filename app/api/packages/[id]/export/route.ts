import { ExportStartBodySchema, type JobStartResponse } from "@/lib/contract/schemas";
import { startExport } from "@/lib/server/export";
import { readJson, respond } from "@/lib/server/http";
import { layers } from "@/lib/server/layers";

/** Starts the export + verification job; the browser polls the job route. */
export async function POST(request: Request, context: RouteContext<"/api/packages/[id]/export">) {
  return respond(async () => {
    const { id } = await context.params;
    const body = await readJson(request, ExportStartBodySchema);
    const job = await startExport(id, body, layers);
    const response: JobStartResponse = { jobId: job.id };

    return Response.json(response);
  });
}
