import { ExportStartBodySchema } from "@/lib/contract/schemas";
import { readJson, respond } from "@/lib/server/http";

// Stub (KTD3): replaced in U12.

export async function POST(request: Request) {
  return respond(async () => {
    await readJson(request, ExportStartBodySchema);

    return Response.json({ jobId: `job-stub-${Date.now()}` });
  });
}
