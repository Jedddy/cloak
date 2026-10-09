import { ScanStartBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U10. The job id carries its start time, so the
// stub job route can advance the fake job without state.

export async function POST(request: Request) {
  return respond(async () => {
    await readJson(request, ScanStartBodySchema);

    return Response.json({ jobId: `job-stub-${Date.now()}` });
  });
}
