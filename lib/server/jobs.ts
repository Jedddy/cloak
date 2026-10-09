import { randomUUID } from "node:crypto";

import type { FileProgressStatus, Job, JobKind, Mode } from "@/lib/contract/schemas";

import { logEvent } from "./log";

// Background jobs live in the server process (R11). The registry sits on
// globalThis, so a dev hot reload keeps running jobs; a server restart
// loses them, and the package route reports that as interrupted (KTD5).
// One scan or export job runs per package at a time (KTD11).

type Registry = {
  jobs: Map<string, Job>;
  /** packageId -> id of the job that runs for it now. */
  live: Map<string, string>;
};

type RegistryGlobal = typeof globalThis & { __sentineldesk_jobs?: Registry };

// SAFETY: the only change is one optional, namespaced key that only this module reads and writes.
const registryGlobal = globalThis as RegistryGlobal;

registryGlobal.__sentineldesk_jobs ??= { jobs: new Map(), live: new Map() };

const registry = registryGlobal.__sentineldesk_jobs;

/** What a running job body can report. */
export type JobProgress = {
  setFile: (fileId: string, status: FileProgressStatus, reason?: string | null) => void;
  setMode: (mode: Mode) => void;
};

export type JobStart = {
  packageId: string;
  kind: JobKind;
  fileIds: string[];
  run: (progress: JobProgress) => Promise<void>;
};

function update(jobId: string, change: (job: Job) => Job): void {
  const job = registry.jobs.get(jobId);

  if (job !== undefined) {
    registry.jobs.set(jobId, change(job));
  }
}

/** Starts a job, or returns the job that already runs for this package. Finished jobs stay readable. */
export function startJob(start: JobStart): Job {
  const liveId = registry.live.get(start.packageId);
  const live = liveId === undefined ? undefined : registry.jobs.get(liveId);

  if (live !== undefined) {
    return live;
  }

  const job: Job = {
    id: `job-${randomUUID()}`,
    packageId: start.packageId,
    kind: start.kind,
    status: "queued",
    mode: null,
    files: start.fileIds.map((fileId) => ({ fileId, status: "queued", reason: null })),
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  registry.jobs.set(job.id, job);
  registry.live.set(start.packageId, job.id);

  const progress: JobProgress = {
    setFile: (fileId, status, reason = null) =>
      update(job.id, (current) => ({
        ...current,
        files: current.files.map((file) => (file.fileId === fileId ? { fileId, status, reason } : file)),
      })),
    setMode: (mode) => update(job.id, (current) => ({ ...current, mode })),
  };

  void (async () => {
    await Promise.resolve();
    update(job.id, (current) => ({ ...current, status: "running" }));

    try {
      await start.run(progress);
      update(job.id, (current) => ({ ...current, status: "done", finishedAt: new Date().toISOString() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The job stopped with an error.";

      logEvent("job failed", { jobId: job.id, packageId: start.packageId, kind: start.kind });
      update(job.id, (current) => ({
        ...current,
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      }));
    } finally {
      registry.live.delete(start.packageId);
    }
  })();

  return job;
}

export function getJob(jobId: string): Job | null {
  return registry.jobs.get(jobId) ?? null;
}

export function hasLiveJob(packageId: string): boolean {
  return registry.live.has(packageId);
}
