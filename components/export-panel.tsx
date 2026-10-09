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
import { Separator } from "@/components/ui/separator";
import {
  ClientError,
  exportZipUrl,
  startExport,
} from "@/lib/client/client";
import type { Job, PackageDetail } from "@/lib/contract/schemas";
import { modeLabel } from "@/lib/utils";
import { Download } from "lucide-react";
import { toast } from "sonner";

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

  const verification = detail.verification;
  const coverage = verification?.coverage ?? detail.coverage;

  const running =
    job !== null && job.status !== "done" && job.status !== "failed";

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
        files: detail.package.files.map((file) => ({
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
      if (
        startError instanceof ClientError &&
        startError.code === "warnings-not-confirmed"
      ) {
        setConfirmWarnings(true);
      } else {
        toast.error(
          startError instanceof Error ? startError.message : "Export failed.",
        );
      }
    } finally {
      setStarting(false);
    }
  }

  const doneFiles =
    job?.files.filter((file) => file.status === "done").length ?? 0;

  const totalFiles = job?.files.length ?? detail.package.files.length;

  const progress =
    totalFiles === 0 ? 0 : Math.round((doneFiles / totalFiles) * 100);

  const redactions = detail.findings.filter(
    (finding) => finding.decision === "redact",
  );

  const redactionCounts = new Map<string, number>();

  for (const finding of redactions) {
    redactionCounts.set(
      finding.category,
      (redactionCounts.get(finding.category) ?? 0) + 1,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Export reviewed copies</CardTitle>
          <CardDescription>
            Rebuilds every included file with the approved redactions, then
            re-scans the copies for verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {running && <Progress value={progress} aria-label="Export progress" />}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run(false)} disabled={starting || running}>
              {running ? "Exporting…" : "Export reviewed copies"}
            </Button>
            {detail.package.status === "exported" && (
              <Button variant="outline" render={<a href={exportZipUrl(packageId)} />}>
                <Download />
                Download zip
              </Button>
            )}
          </div>
          {detail.warnings.length > 0 && (
            <Alert>
              <AlertTitle>
                {detail.warnings.length} inconsistent redaction
                {detail.warnings.length === 1 ? "" : "s"} still open
              </AlertTitle>
              <AlertDescription>
                Export asks for confirmation while these warnings are open.
              </AlertDescription>
            </Alert>
          )}
          {job?.status === "failed" && (
            <Alert variant="destructive">
              <AlertTitle>Export failed</AlertTitle>
              <AlertDescription>
                {job.error ?? "Unknown error."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {verification && (
        <Card>
          <CardHeader>
            <CardTitle>Verification report</CardTitle>
            <CardDescription>{verification.text}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">
                {coverage
                  ? `${coverage.filesProcessed} of ${coverage.filesTotal} files re-scanned`
                  : "No coverage yet"}
              </Badge>
              {coverage && (
                <>
                  <Badge variant="outline">
                    Mode: {modeLabel(coverage.mode)} ({coverage.locality})
                  </Badge>
                  {(coverage.models.text ?? coverage.models.vision) && (
                    <Badge variant="outline">
                      {[coverage.models.text, coverage.models.vision]
                        .filter((model) => model !== null)
                        .join(" · ")}
                    </Badge>
                  )}
                </>
              )}
              <Badge variant={verification.originalsUnchanged ? "secondary" : "destructive"}>
                {verification.originalsUnchanged
                  ? "Originals unchanged"
                  : "Originals changed"}
              </Badge>
            </div>
            <Separator />
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Files excluded
                </dt>
                <dd className="tabular-nums">
                  {coverage?.filesExcluded.length ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Open findings after re-scan
                </dt>
                <dd className="tabular-nums">
                  {verification.openFindings.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Files not analyzed by AI
                </dt>
                <dd>
                  {(coverage?.filesWithoutAi.length ?? 0) === 0
                    ? "None"
                    : coverage?.filesWithoutAi.map((file) => file.fileId).join(", ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Unsupported files
                </dt>
                <dd>
                  {(coverage?.filesUnsupported.length ?? 0) === 0
                    ? "None"
                    : coverage?.filesUnsupported.join(", ")}
                </dd>
              </div>
            </dl>
            <Separator />
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Redactions applied per category
              </p>
              {redactionCounts.size === 0 ? (
                <p className="text-muted-foreground">None.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {Array.from(redactionCounts.entries()).map(
                    ([itemCategory, count]) => (
                      <li key={itemCategory}>
                        <Badge variant="outline" className="tabular-nums">
                          {itemCategory}: {count}
                        </Badge>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
            {verification.openFindings.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Open findings
                  </p>
                  <ul className="flex flex-col gap-1">
                    {verification.openFindings.map((finding) => (
                      <li key={finding.id}>
                        <button
                          type="button"
                          className="underline-offset-4 hover:underline"
                          onClick={onReview}
                        >
                          {finding.title}
                        </button>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {detail.package.files.find(
                            (file) => file.id === finding.fileId,
                          )?.originalName ?? finding.fileId}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            <div>
              <Button variant="outline" render={<a href={exportZipUrl(packageId)} />}>
                <Download />
                Download zip
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmWarnings} onOpenChange={setConfirmWarnings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warnings are still open</DialogTitle>
            <DialogDescription>
              These inconsistencies will stay in the export:
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
            {detail.warnings.map((warning) => (
              <li key={`${warning.term}-${warning.relatedGroupId}`}>
                {warning.message}
              </li>
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
