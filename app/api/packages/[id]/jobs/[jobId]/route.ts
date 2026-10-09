import { connection, type NextRequest } from "next/server";

import { fixtureFiles, fixtureJob } from "@/lib/contract/fixtures";
import type { FileProgress, Job } from "@/lib/contract/schemas";

// Stub (KTD3): replaced in U9. A `job-stub-<ms>` id advances one file per
// 1.5 s, and the model "fails" after file 3 so the UI can test the
// rules-only banner. Any other id returns the finished fixture job.

const msPerFile = 1500;

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/packages/[id]/jobs/[jobId]">,
) {
  await connection();

  const { id, jobId } = await context.params;
  const startedMs = Number(jobId.replace("job-stub-", ""));

  if (!jobId.startsWith("job-stub-") || Number.isNaN(startedMs)) {
    return Response.json(fixtureJob);
  }

  const current = Math.floor((Date.now() - startedMs) / msPerFile);
  const done = current >= fixtureFiles.length;

  const files: FileProgress[] = fixtureFiles.map((file, index) => {
    if (index > current) {
      return { fileId: file.id, status: "queued", reason: null };
    }

    if (index === current) {
      return { fileId: file.id, status: "rules", reason: null };
    }

    if (file.status === "failed") {
      return { fileId: file.id, status: "failed", reason: file.failureReason };
    }

    return { fileId: file.id, status: "done", reason: null };
  });

  let finishedAt: string | null = null;

  if (done) {
    finishedAt = new Date(startedMs + fixtureFiles.length * msPerFile).toISOString();
  }

  const job: Job = {
    id: jobId,
    packageId: id,
    kind: "scan",
    status: done ? "done" : "running",
    mode: current >= 3 ? "rules-only" : "full",
    files,
    error: null,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt,
  };

  return Response.json(job);
}
