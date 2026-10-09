"use client";

import { useEffect, useMemo, useState } from "react";

import { FindingCard } from "@/components/finding-card";
import { ImageViewer } from "@/components/image-viewer";
import { TextViewer } from "@/components/text-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  decideFinding,
  findRelated,
  originalFileUrl,
  saveRegion,
  updateFile,
} from "@/lib/client/client";
import type {
  Box,
  Decision,
  FileEntry,
  Finding,
  PackageDetail,
  RelatedResult,
} from "@/lib/contract/schemas";
import { cn, formatBytes } from "@/lib/utils";
import {
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  OctagonX,
} from "lucide-react";
import { toast } from "sonner";

function aiNote(file: FileEntry): string | null {
  if (file.aiAnalysis === "done") {
    return null;
  }
  if (file.aiAnalysis === "skipped-no-model") {
    return "No AI analysis: no model was reachable.";
  }
  if (file.aiAnalysis === "skipped-too-large") {
    return "No AI analysis: the file was too large.";
  }
  return "AI analysis failed for this file.";
}

function relatedTermOf(finding: Finding): string {
  for (const detection of finding.detections) {
    for (const evidence of detection.evidence) {
      if (evidence.type === "text-span" && evidence.quote.trim() !== "") {
        return evidence.quote;
      }
      if (evidence.type === "image-region" && evidence.quote) {
        return evidence.quote;
      }
    }
  }
  return finding.title;
}

export function ReviewPanel({
  packageId,
  detail,
  onRefresh,
}: {
  packageId: string;
  detail: PackageDetail;
  onRefresh: () => Promise<void>;
}) {
  const files = detail.package.files;
  const [fileId, setFileId] = useState<string>(files[0]?.id ?? "");
  const [findingId, setFindingId] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [method, setMethod] = useState("all");
  const [status, setStatus] = useState("open");
  const [busy, setBusy] = useState(false);
  const [related, setRelated] = useState<RelatedResult | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);

  const selectedFile = files.find((file) => file.id === fileId) ?? files[0];
  const fileFindings = useMemo(
    () =>
      selectedFile
        ? detail.findings.filter((finding) => finding.fileId === selectedFile.id)
        : [],
    [detail.findings, selectedFile],
  );

  const categories = useMemo(
    () => Array.from(new Set(fileFindings.map((finding) => finding.category))),
    [fileFindings],
  );
  const methods = useMemo(
    () =>
      Array.from(
        new Set(
          fileFindings.flatMap((finding) =>
            finding.detections.map((detection) => detection.method),
          ),
        ),
      ),
    [fileFindings],
  );

  const visible = fileFindings.filter((finding) => {
    if (category !== "all" && finding.category !== category) {
      return false;
    }
    if (
      method !== "all" &&
      !finding.detections.some((detection) => detection.method === method)
    ) {
      return false;
    }
    if (status === "open" && finding.decision !== "open") {
      return false;
    }
    if (status === "decided" && finding.decision === "open") {
      return false;
    }
    return true;
  });

  const selected =
    fileFindings.find((finding) => finding.id === findingId) ??
    visible[0] ??
    null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // SAFETY: keydown targets in this view are elements; the tag checks below narrow them.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }
      if (event.key === "n" || event.key === "p") {
        if (visible.length === 0) {
          return;
        }
        const index = visible.findIndex(
          (finding) => finding.id === (selected?.id ?? ""),
        );
        const next =
          event.key === "n"
            ? visible[(index + 1) % visible.length]
            : visible[(index - 1 + visible.length) % visible.length];
        setFindingId(next.id);
      } else if ((event.key === "r" || event.key === "k") && selected) {
        decide(selected.id, event.key === "r" ? "redact" : "keep");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function decide(id: string, decision: Decision) {
    setBusy(true);
    try {
      await decideFinding(packageId, id, { decision, applyToGroup: false });
      await onRefresh();
    } catch (decideError) {
      toast.error(
        decideError instanceof Error ? decideError.message : "Decision failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function excludeFile(id: string) {
    setBusy(true);
    try {
      await updateFile(packageId, id, { excluded: true });
      await onRefresh();
      toast.success("File excluded from export.");
    } catch (excludeError) {
      toast.error(
        excludeError instanceof Error ? excludeError.message : "Exclude failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function drawBox(box: Box) {
    if (!selectedFile) {
      return;
    }
    setBusy(true);
    try {
      if (selected && selected.detections.every((detection) => detection.evidence.every((evidence) => evidence.type === "image-whole"))) {
        await saveRegion(packageId, {
          action: "update",
          findingId: selected.id,
          box,
        });
      } else {
        await saveRegion(packageId, {
          action: "add",
          fileId: selectedFile.id,
          box,
          category: "other",
        });
      }
      await onRefresh();
    } catch (regionError) {
      toast.error(
        regionError instanceof Error ? regionError.message : "Box failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function moveBox(id: string, box: Box) {
    setBusy(true);
    try {
      await saveRegion(packageId, { action: "update", findingId: id, box });
      await onRefresh();
    } catch (moveError) {
      toast.error(
        moveError instanceof Error ? moveError.message : "Move failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteBox(id: string) {
    setBusy(true);
    try {
      await saveRegion(packageId, { action: "delete", findingId: id });
      await onRefresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "Delete failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openRelated(finding: Finding) {
    try {
      const result = await findRelated(packageId, {
        term: relatedTermOf(finding),
      });
      setRelated(result);
      setRelatedOpen(true);
    } catch (relatedError) {
      toast.error(
        relatedError instanceof Error
          ? relatedError.message
          : "Search failed.",
      );
    }
  }

  async function redactGroup() {
    if (!related || related.exact.length === 0) {
      return;
    }
    setBusy(true);
    try {
      await decideFinding(packageId, related.exact[0].id, {
        decision: "redact",
        applyToGroup: true,
      });
      await onRefresh();
      setRelatedOpen(false);
      toast.success("Group redacted.");
    } catch (groupError) {
      toast.error(
        groupError instanceof Error ? groupError.message : "Group failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFile) {
    return (
      <p className="text-sm text-muted-foreground">
        Upload files to start reviewing.
      </p>
    );
  }

  const needsBox =
    selected !== null &&
    selected.detections.length > 0 &&
    selected.detections.every((detection) =>
      detection.evidence.every((evidence) => evidence.type === "image-whole"),
    );

  return (
    <div className="flex flex-col gap-3">
      {detail.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Inconsistent redactions</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {detail.warnings.map((warning) => (
                <li key={`${warning.term}-${warning.relatedGroupId}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <ScrollArea className="max-h-[60vh]">
              <ul className="flex flex-col gap-0.5 pr-2">
                {files.map((file) => {
                  const open = detail.findings.filter(
                    (finding) =>
                      finding.fileId === file.id &&
                      finding.decision === "open",
                  ).length;
                  const note = aiNote(file);
                  const active = file.id === selectedFile.id;
                  return (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => setFileId(file.id)}
                        aria-current={active}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                          active && "bg-selection",
                        )}
                      >
                        <span className="mt-0.5 shrink-0">
                          {file.status === "failed" ? (
                            <OctagonX className="size-4 text-destructive" />
                          ) : file.kind === "image" ? (
                            <ImageIcon className="size-4 text-muted-foreground" />
                          ) : (
                            <FileText className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs">
                            {file.originalName}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground tabular-nums">
                            <span>
                              {open} open · {formatBytes(file.sizeBytes)}
                            </span>
                            {file.excluded && <Badge variant="outline">excluded</Badge>}
                            {file.kind === "unsupported" && (
                              <Badge variant="outline">not supported</Badge>
                            )}
                            {file.status === "failed" && (
                              <Badge variant="destructive">failed</Badge>
                            )}
                            {note && (
                              <Badge variant="outline" className="bg-warning-muted text-warning">
                                no AI
                              </Badge>
                            )}
                          </span>
                          {file.status === "failed" && file.failureReason && (
                            <span className="mt-0.5 block text-xs text-destructive">
                              {file.failureReason}
                            </span>
                          )}
                          {note && file.status !== "failed" && (
                            <span className="mt-0.5 block text-xs text-warning">
                              {note}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="truncate font-mono text-sm font-medium">
              {selectedFile.originalName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedFile.kind === "text" ? (
              <TextViewer
                fileUrl={originalFileUrl(packageId, selectedFile.id)}
                fileName={selectedFile.originalName}
                findings={fileFindings}
                selectedFindingId={selected?.id ?? null}
                onSelectFinding={setFindingId}
              />
            ) : selectedFile.kind === "image" ? (
              <ImageViewer
                imageUrl={originalFileUrl(packageId, selectedFile.id)}
                fileName={selectedFile.originalName}
                findings={fileFindings}
                selectedFindingId={selected?.id ?? null}
                needsBox={needsBox}
                onSelectFinding={setFindingId}
                onDraw={drawBox}
                onMove={moveBox}
                onDeleteBox={deleteBox}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This file type is listed as not supported. It is never treated
                as reviewed.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Select
              value={category}
              onValueChange={(value: string | null) => {
                if (value !== null) {
                  setCategory(value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={method}
              onValueChange={(value: string | null) => {
                if (value !== null) {
                  setMethod(value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by method">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                {methods.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value: string | null) => {
                if (value !== null) {
                  setStatus(value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="decided">Decided</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Keys: n next · p previous · r redact · k keep
          </p>
          <Separator />
          <ScrollArea className="max-h-[55vh]">
            <div className="flex flex-col gap-2 pr-2">
              {visible.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No findings match these filters.
                </p>
              )}
              {visible.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  selected={finding.id === selected?.id}
                  disabled={busy}
                  onSelect={() => setFindingId(finding.id)}
                  onDecide={(decision) => decide(finding.id, decision)}
                  onExcludeFile={() => excludeFile(finding.fileId)}
                  onFindRelated={() => openRelated(finding)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      <Dialog open={relatedOpen} onOpenChange={setRelatedOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Related occurrences</DialogTitle>
            <DialogDescription>
              {related ? `Matches for "${related.term}".` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Exact matches ({related?.exact.length ?? 0})
              </p>
              {(related?.exact ?? []).map((finding) => (
                <p key={finding.id} className="text-sm">
                  {finding.title} ·{" "}
                  <span className="font-mono text-xs">
                    {detail.package.files.find(
                      (file) => file.id === finding.fileId,
                    )?.originalName ?? finding.fileId}
                  </span>
                </p>
              ))}
              {(related?.exact.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Possible related, AI suggestion (
                {related?.aiSuggestions.length ?? 0})
              </p>
              {(related?.aiSuggestions ?? []).map((finding) => (
                <p key={finding.id} className="text-sm">
                  {finding.title} ·{" "}
                  <span className="font-mono text-xs">
                    {detail.package.files.find(
                      (file) => file.id === finding.fileId,
                    )?.originalName ?? finding.fileId}
                  </span>
                </p>
              ))}
              {(related?.aiSuggestions.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRelatedOpen(false)}
              disabled={busy}
            >
              Close
            </Button>
            <Button
              onClick={redactGroup}
              disabled={
                busy || !related || related.exact.length === 0
              }
            >
              Redact full group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
