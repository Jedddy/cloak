import { expect, test } from "bun:test";

import type { FileProgressStatus, JobStatus } from "@/lib/contract/schemas";

import { getJob, hasLiveJob, startJob } from "./jobs";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a started job reports queued, then per-file statuses in order, then done", async () => {
  const gates = [deferred(), deferred()];
  const seen: FileProgressStatus[][] = [];

  const job = startJob({
    packageId: "pkg-order",
    kind: "scan",
    fileIds: ["a", "b"],
    run: async (progress) => {
      progress.setFile("a", "rules");
      await gates[0]?.promise;
      progress.setFile("a", "done");
      progress.setFile("b", "rules");
      await gates[1]?.promise;
      progress.setFile("b", "done");
    },
  });

  const statuses: JobStatus[] = [job.status];
  const snapshot = () => (getJob(job.id)?.files ?? []).map((file) => file.status);

  seen.push(job.files.map((file) => file.status));
  await waitFor(() => snapshot()[0] === "rules");
  seen.push(snapshot());
  statuses.push(getJob(job.id)?.status ?? "failed");
  gates[0]?.release();
  await waitFor(() => snapshot()[1] === "rules");
  seen.push(snapshot());
  gates[1]?.release();
  await waitFor(() => getJob(job.id)?.status === "done");
  seen.push(snapshot());
  statuses.push(getJob(job.id)?.status ?? "failed");

  expect(statuses).toEqual(["queued", "running", "done"]);
  expect(seen).toEqual([
    ["queued", "queued"],
    ["rules", "queued"],
    ["done", "rules"],
    ["done", "done"],
  ]);
  expect(getJob(job.id)?.finishedAt).not.toBeNull();
});

test("a job whose body throws ends as failed and releases the package lock", async () => {
  const job = startJob({
    packageId: "pkg-throws",
    kind: "export",
    fileIds: [],
    run: async () => {
      throw new Error("The disk is full.");
    },
  });

  await waitFor(() => getJob(job.id)?.status === "failed");

  expect(getJob(job.id)?.error).toBe("The disk is full.");
  expect(hasLiveJob("pkg-throws")).toBe(false);
});

test("a second start for the same package while one runs returns the same job", async () => {
  const gate = deferred();

  const first = startJob({
    packageId: "pkg-twice",
    kind: "scan",
    fileIds: ["a"],
    run: () => gate.promise,
  });

  const second = startJob({
    packageId: "pkg-twice",
    kind: "export",
    fileIds: ["a"],
    run: async () => {},
  });

  expect(second.id).toBe(first.id);
  expect(hasLiveJob("pkg-twice")).toBe(true);

  gate.release();
  await waitFor(() => getJob(first.id)?.status === "done");

  expect(hasLiveJob("pkg-twice")).toBe(false);
});
