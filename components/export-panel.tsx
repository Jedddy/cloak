"use client";

import { useState, type ReactNode } from "react";

import { DecisionMark } from "@/components/finding-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { ClientError, exportZipUrl, startExport } from "@/lib/client/client";
import type { Category, Job, PackageDetail } from "@/lib/contract/schemas";
import {
  categoryLabel,
  cn,
  fileNameOf,
  formatDateTime,
  localityLabel,
  modeLabel,
  openFindingsOf,
  plural,
} from "@/lib/utils";
import { AlertTriangle, CircleCheck, Download } from "lucide-react";
import { toast } from "sonner";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ExportPanel({
  packageId,
  detail,
  job,
  onJob,
  onRefresh,
  onReview,
}: {
  packageId: string;
  detail: PackageDetail;
  job: Job | null;
  onJob: (job: Job | null) => void;
  onRefresh: () => Promise<void>;
  onReview: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);

  const files = detail.package.files;
  const verification = detail.verification;
  const coverage = verification?.coverage ?? detail.coverage;
  const exported = detail.package.status === "exported";

  const running = job !== null && job.status !== "done" && job.status !== "failed";

  async function run(confirmed: boolean) {
    setStarting(true);

    try {
      const { jobId } = await startExport(packageId, {
        confirmWarnings: confirmed,
      });

      onJob({
        id: jobId,
        packageId,
        kind: "export",
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
      setConfirmWarnings(false);
      await onRefresh();
    } catch (startError) {
      if (startError instanceof ClientError && startError.code === "warnings-not-confirmed") {
        setConfirmWarnings(true);
      } else {
        toast.error(startError instanceof Error ? startError.message : "Export failed.");
      }
    } finally {
      setStarting(false);
    }
  }

  const doneFiles = job?.files.filter((file) => file.status === "done").length ?? 0;

  const totalFiles = job?.files.length ?? files.length;

  const progress = totalFiles === 0 ? 0 : Math.round((doneFiles / totalFiles) * 100);

  const redactionCounts = new Map<Category, number>();

  for (const finding of detail.findings) {
    if (finding.decision === "redact") {
      redactionCounts.set(finding.category, (redactionCounts.get(finding.category) ?? 0) + 1);
    }
  }

  const redactionTotal = Array.from(redactionCounts.values()).reduce(
    (sum, count) => sum + count,
    0,
  );

  const openCount = openFindingsOf(detail.findings);
  const excludedCount = files.filter((file) => file.excluded).length;
  const clean = verification?.status === "no-open-findings";

  const names = (ids: string[]) =>
    ids.length === 0 ? (
      <span className="text-muted-foreground">None</span>
    ) : (
      <span className="font-mono text-[0.8125rem]">
        {ids.map((fileId) => fileNameOf(files, fileId)).join(", ")}
      </span>
    );

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8 px-6 py-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Export reviewed copies</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Export rebuilds every included file with solid-fill redactions, strips metadata, and
              scans the copies again. The originals stay unchanged.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={exported ? "outline" : "default"}
              onClick={() => run(false)}
              disabled={starting || running}
            >
              {(starting || running) && <Spinner data-icon="inline-start" />}
              {running && "Exporting…"}
              {!running && (exported ? "Export again" : "Export reviewed copies")}
            </Button>
            {exported && !running && (
              <a href={exportZipUrl(packageId)} className={buttonVariants()}>
                <Download data-icon="inline-start" />
                Download zip
              </a>
            )}
          </div>
        </div>

        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <li>
            <span className="font-medium tabular-nums">{redactionTotal}</span>{" "}
            <span className="text-muted-foreground">
              {redactionTotal === 1 ? "redaction" : "redactions"} approved
            </span>
          </li>
          <li className={cn(openCount > 0 && "text-warning")}>
            <span className="font-medium tabular-nums">{openCount}</span>{" "}
            <span className={cn(openCount === 0 && "text-muted-foreground")}>
              {openCount === 1 ? "finding" : "findings"} still open
            </span>
          </li>
          <li>
            <span className="font-medium tabular-nums">{excludedCount}</span>{" "}
            <span className="text-muted-foreground">
              {excludedCount === 1 ? "file" : "files"} excluded
            </span>
          </li>
        </ul>

        {running && <Progress value={progress} aria-label="Export progress" />}

        {detail.warnings.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-md bg-warning-muted px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">
                {plural(detail.warnings.length, "inconsistent redaction")} still open.
              </span>{" "}
              Export asks you to confirm while these warnings are open.
            </p>
          </div>
        )}
        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertTitle>Export failed</AlertTitle>
            <AlertDescription>{job.error ?? "Unknown error."}</AlertDescription>
          </Alert>
        )}
      </section>

      {verification && (
        <section aria-labelledby="verification-title" className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            {clean ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            )}
            <div className="flex flex-col gap-1">
              <h2 id="verification-title" className="text-lg font-semibold tracking-tight">
                {verification.text}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">
                Verification scanned the reviewed copies again. Checked{" "}
                {formatDateTime(verification.checkedAt)}.
              </p>
            </div>
          </div>

          <dl className="divide-y overflow-hidden rounded-lg border bg-card">
            <Row label="Files scanned again">
              <span className="tabular-nums">
                {coverage ? `${coverage.filesProcessed} of ${coverage.filesTotal}` : "No coverage"}
              </span>
            </Row>
            {coverage && (
              <Row label="Mode">
                {modeLabel(coverage.mode)} · {localityLabel(coverage.locality)}
                {(coverage.models.text ?? coverage.models.vision) && (
                  <span className="mt-0.5 block font-mono text-[0.8125rem] text-muted-foreground">
                    {Array.from(
                      new Set(
                        [coverage.models.text, coverage.models.vision].filter(
                          (model) => model !== null,
                        ),
                      ),
                    ).join(", ")}
                  </span>
                )}
              </Row>
            )}
            <Row label="Originals">
              {verification.originalsUnchanged ? (
                "Unchanged"
              ) : (
                <span className="text-destructive">Changed since upload</span>
              )}
            </Row>
            <Row label="Redactions applied">
              {redactionCounts.size === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {Array.from(redactionCounts.entries()).map(([itemCategory, count]) => (
                    <li key={itemCategory} className="flex justify-between gap-4 sm:max-w-72">
                      <span>{categoryLabel(itemCategory)}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Files excluded">{names(coverage?.filesExcluded ?? [])}</Row>
            <Row label="Files not analyzed by AI">
              {names((coverage?.filesWithoutAi ?? []).map((file) => file.fileId))}
            </Row>
            <Row label="Unsupported files">{names(coverage?.filesUnsupported ?? [])}</Row>
          </dl>

          {verification.openFindings.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Open findings on the reviewed copies</h3>
              <ul className="overflow-hidden rounded-lg border bg-card">
                {verification.openFindings.map((finding) => (
                  <li key={finding.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-accent"
                      onClick={onReview}
                    >
                      <span className="flex w-3.5 justify-center">
                        <DecisionMark decision={finding.decision} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{finding.title}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {categoryLabel(finding.category)}
                      </span>
                      <span className="w-40 shrink-0 truncate text-right font-mono text-xs text-muted-foreground">
                        {fileNameOf(files, finding.fileId)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <Dialog open={confirmWarnings} onOpenChange={setConfirmWarnings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warnings are still open</DialogTitle>
            <DialogDescription>These inconsistencies will stay in the export:</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
            {detail.warnings.map((warning) => (
              <li key={`${warning.term}-${warning.relatedGroupId}`}>{warning.message}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              onClick={() => {
                setConfirmWarnings(false);
                onReview();
              }}
              variant="outline"
            >
              Back to review
            </Button>
            <Button onClick={() => run(true)} disabled={starting}>
              Export anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
