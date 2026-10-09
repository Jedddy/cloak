"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ClientError, startScan } from "@/lib/client/client";
import type { Job, PackageDetail } from "@/lib/contract/schemas";
import { modeLabel } from "@/lib/utils";
import { toast } from "sonner";

export function ScanPanel({
  packageId,
  detail,
  job,
  remoteHost,
  onJob,
  onRefresh,
  onReview,
}: {
  packageId: string;
  detail: PackageDetail;
  job: Job | null;
  remoteHost: string | null;
  onJob: (job: Job | null) => void;
  onRefresh: () => Promise<void>;
  onReview: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [confirmRemote, setConfirmRemote] = useState(false);

  const coverage = detail.coverage;
  const files = detail.package.files;
  const doneCount =
    job?.files.filter(
      (file) => file.status === "done" || file.status === "failed",
    ).length ?? files.filter((file) => file.status !== "pending").length;
  const failedCount =
    coverage?.filesFailed.length ??
    files.filter((file) => file.status === "failed").length;
  const openCount = detail.findings.filter(
    (finding) => finding.decision === "open",
  ).length;
  const mode = job?.mode ?? coverage?.mode ?? null;
  const progress =
    files.length === 0 ? 0 : Math.round((doneCount / files.length) * 100);

  async function run(confirmed: boolean) {
    setStarting(true);
    try {
      const { jobId } = await startScan(packageId, {
        confirmRemote: confirmed,
      });
      onJob({
        id: jobId,
        packageId,
        kind: "scan",
        status: "queued",
        mode: null,
        files: files.map((file) => ({
          fileId: file.id,
          status: "queued",
          reason: null,
        })),
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
      setConfirmRemote(false);
      await onRefresh();
    } catch (startError) {
      if (startError instanceof ClientError && startError.code === "remote-not-confirmed") {
        setConfirmRemote(true);
      } else {
        toast.error(
          startError instanceof Error ? startError.message : "Scan failed.",
        );
      }
    } finally {
      setStarting(false);
    }
  }

  const running = job !== null && job.status !== "done" && job.status !== "failed";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Scan progress</CardTitle>
          <CardDescription>
            {doneCount} of {files.length} files scanned · {openCount} findings
            to review · {failedCount} files could not be read
            {mode ? ` · Mode: ${modeLabel(mode)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={progress} aria-label="Scan progress" />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run(false)} disabled={starting || running}>
              {running ? "Scanning…" : "Scan package"}
            </Button>
            {job?.status === "done" && (
              <Button variant="outline" onClick={onReview}>
                Review findings
              </Button>
            )}
          </div>
          {mode === "rules-only" && (
            <Alert>
              <AlertTitle>Rules only</AlertTitle>
              <AlertDescription>
                AI analysis did not run. These results come from rules,
                structure checks, and protected terms only.
              </AlertDescription>
            </Alert>
          )}
          {job?.status === "failed" && (
            <Alert variant="destructive">
              <AlertTitle>Scan failed</AlertTitle>
              <AlertDescription>{job.error ?? "Unknown error."}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1">
            {(job?.files ?? []).length > 0
              ? job?.files.map((file) => {
                  const entry = files.find((item) => item.id === file.fileId);
                  return (
                    <li
                      key={file.fileId}
                      className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="truncate font-mono text-[0.8125rem]">
                        {entry?.originalName ?? file.fileId}
                      </span>
                      <span className="flex items-center gap-2">
                        {file.status === "failed" && file.reason && (
                          <span className="text-xs text-destructive">
                            {file.reason}
                          </span>
                        )}
                        <Badge
                          variant={
                            file.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {file.status}
                        </Badge>
                      </span>
                    </li>
                  );
                })
              : files.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="truncate font-mono text-[0.8125rem]">
                      {file.originalName}
                    </span>
                    <span className="flex items-center gap-2">
                      {file.status === "failed" && file.failureReason && (
                        <span className="text-xs text-destructive">
                          {file.failureReason}
                        </span>
                      )}
                      <Badge
                        variant={
                          file.status === "failed" ? "destructive" : "secondary"
                        }
                      >
                        {file.status}
                      </Badge>
                    </span>
                  </li>
                ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={confirmRemote} onOpenChange={setConfirmRemote}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send files to a remote model?</DialogTitle>
            <DialogDescription>
              File text and images will be sent to `{remoteHost ?? "the remote host"}`.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemote(false)}>
              Cancel
            </Button>
            <Button onClick={() => run(true)} disabled={starting}>
              Send and scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
