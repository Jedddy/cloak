"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { ClientError, startScan } from "@/lib/client/client";
import type { FileEntry, FileProgressStatus, Job, PackageDetail } from "@/lib/contract/schemas";
import {
  cn,
  fileNameOf,
  formatBytes,
  localityLabel,
  modeLabel,
  openFindingsOf,
  plural,
} from "@/lib/utils";
import { ArrowRight, FileText, Image as ImageIcon, FileQuestion } from "lucide-react";
import { toast } from "sonner";

const stageLabels: Record<FileProgressStatus, string> = {
  queued: "Queued",
  reading: "Reading the file",
  ocr: "Reading text in the image",
  rules: "Running rules and structure checks",
  "ai-text": "AI text analysis",
  "ai-vision": "AI vision analysis",
  done: "Done",
  failed: "Could not be read",
};

const kindIcons: Record<FileEntry["kind"], typeof FileText> = {
  image: ImageIcon,
  text: FileText,
  document: FileText,
  unsupported: FileQuestion,
};

function fileStateOf(file: FileEntry, open: number): string {
  if (file.status === "pending") {
    return "Not scanned";
  }

  if (file.status === "unsupported") {
    return "Not supported";
  }

  if (file.status === "failed") {
    return "Could not be read";
  }

  return open === 0 ? "No open findings" : plural(open, "open finding");
}

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
  const scanned = detail.package.lastScan !== null;

  const doneCount =
    job?.files.filter((file) => file.status === "done" || file.status === "failed").length ??
    files.filter((file) => file.status !== "pending").length;

  const failedCount =
    coverage?.filesFailed.length ?? files.filter((file) => file.status === "failed").length;

  const openCount = openFindingsOf(detail.findings);
  const mode = job?.mode ?? coverage?.mode ?? null;

  const progress = files.length === 0 ? 0 : Math.round((doneCount / files.length) * 100);

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
        toast.error(startError instanceof Error ? startError.message : "Scan failed.");
      }
    } finally {
      setStarting(false);
    }
  }

  const running = job !== null && job.status !== "done" && job.status !== "failed";

  let heading = "Not scanned yet";

  if (running) {
    heading = `Scanning ${doneCount} of ${plural(files.length, "file")}`;
  } else if (scanned && openCount > 0) {
    heading = `${plural(openCount, "finding")} to review`;
  } else if (scanned) {
    heading = "No open findings";
  }

  const models = coverage
    ? [coverage.models.text, coverage.models.vision].filter(
        (model, index, list): model is string => model !== null && list.indexOf(model) === index,
      )
    : [];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {!scanned &&
                !running &&
                "The scan reads each file on this machine with rules, OCR, structure checks, and the configured model. The original files stay unchanged."}
              {(scanned || running) &&
                [
                  mode ? `Mode: ${modeLabel(mode)}` : null,
                  coverage ? localityLabel(coverage.locality) : null,
                  failedCount > 0 ? `${plural(failedCount, "file")} could not be read` : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              {models.length > 0 && !running && (
                <>
                  {" · "}
                  <span className="font-mono text-xs">{models.join(", ")}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {scanned && !running && openCount > 0 && (
              <>
                <Button variant="outline" onClick={() => run(false)} disabled={starting}>
                  Scan again
                </Button>
                <Button onClick={onReview}>
                  Review findings
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </>
            )}
            {(!scanned || running || openCount === 0) && (
              <Button
                variant={scanned && !running ? "outline" : "default"}
                onClick={() => run(false)}
                disabled={starting || running || files.length === 0}
              >
                {(starting || running) && <Spinner data-icon="inline-start" />}
                {running && "Scanning…"}
                {!running && (scanned ? "Scan again" : "Scan package")}
              </Button>
            )}
          </div>
        </div>
        {running && <Progress value={progress} aria-label="Scan progress" />}
        {mode === "rules-only" && (
          <Alert className="border-transparent bg-warning-muted text-warning">
            <AlertTitle>Rules only</AlertTitle>
            <AlertDescription className="text-warning/90">
              AI analysis did not run. These results come from rules, structure checks, and
              protected terms only.
            </AlertDescription>
          </Alert>
        )}
        {coverage?.modeFallback && (
          <Alert className="border-transparent bg-warning-muted text-warning">
            <AlertTitle>The model stopped during the scan</AlertTitle>
            <AlertDescription className="text-warning/90">
              From {fileNameOf(files, coverage.modeFallback.atFileId)} on, files were scanned with
              rules only. {coverage.modeFallback.reason}
            </AlertDescription>
          </Alert>
        )}
        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertTitle>Scan failed</AlertTitle>
            <AlertDescription>{job.error ?? "Unknown error."}</AlertDescription>
          </Alert>
        )}
      </section>

      <section aria-label="Files" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Files</h3>
        <ul className="overflow-hidden rounded-lg border bg-card">
          {files.map((file) => {
            const progressEntry = job?.files.find((item) => item.fileId === file.id);
            const open = openFindingsOf(detail.findings, file.id);

            const active =
              running &&
              progressEntry !== undefined &&
              progressEntry.status !== "queued" &&
              progressEntry.status !== "done" &&
              progressEntry.status !== "failed";

            const failed =
              progressEntry?.status === "failed" || (!progressEntry && file.status === "failed");

            const reason = progressEntry?.reason ?? file.failureReason;
            const Icon = kindIcons[file.kind];

            return (
              <li
                key={file.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.8125rem]">
                    {file.originalName}
                  </span>
                  {failed && reason && (
                    <span className="block text-xs text-destructive">{reason}</span>
                  )}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                  {formatBytes(file.sizeBytes)}
                </span>
                <span
                  className={cn(
                    "flex w-56 shrink-0 items-center justify-end gap-2 text-right text-xs text-muted-foreground",
                    failed && "text-destructive",
                    !progressEntry && file.kind === "unsupported" && "text-warning",
                    !running && open > 0 && "font-medium text-foreground",
                  )}
                >
                  {active && <Spinner className="size-3" />}
                  {progressEntry && running
                    ? stageLabels[progressEntry.status]
                    : fileStateOf(file, open)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Dialog open={confirmRemote} onOpenChange={setConfirmRemote}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send files to a remote model?</DialogTitle>
            <DialogDescription>
              The model server is not on this machine or the local network. File text and images
              will be sent to{" "}
              <span className="font-medium text-foreground">{remoteHost ?? "the remote host"}</span>
              . You confirm this once for this package.
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
