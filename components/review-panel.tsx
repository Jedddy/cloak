"use client";

import { useEffect, useMemo, useState } from "react";

import { FileList } from "@/components/file-list";
import { DocumentViewer } from "@/components/document-viewer";
import { DecisionMark, FindingRow } from "@/components/finding-card";
import { ImageViewer } from "@/components/image-viewer";
import { PdfViewer } from "@/components/pdf-viewer";
import { TextViewer } from "@/components/text-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDocumentModel } from "@/components/use-document-model";
import {
  decideFinding,
  filePageUrl,
  findRelated,
  getFileDocument,
  originalFileUrl,
  saveRegion,
  updateFile,
} from "@/lib/client/client";
import type { Box, Decision, Finding, PackageDetail, RelatedResult } from "@/lib/contract/schemas";
import { categoryLabel, fileNameOf, formatBytes, methodLabel, plural, quoteOf } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/** A vision finding with no mapped region asks the user to draw a box. */
function needsDrawnBox(finding: Finding): boolean {
  return (
    finding.detections.length > 0 &&
    finding.detections.every((detection) =>
      detection.evidence.every((evidence) => evidence.type === "image-whole"),
    )
  );
}

const statusFilters = [
  { value: "open", label: "Open" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
] as const;

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

  // Documents are extracted by the scan, so a new scan loads the model again.
  const documentKey =
    selectedFile?.kind === "document" ? `${selectedFile.id}:${detail.package.status}` : null;

  const { model: documentModel, error: documentError } = useDocumentModel(documentKey, () =>
    getFileDocument(packageId, selectedFile?.id ?? ""),
  );

  const fileFindings = useMemo(
    () =>
      selectedFile ? detail.findings.filter((finding) => finding.fileId === selectedFile.id) : [],
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

  const openCount = fileFindings.filter((finding) => finding.decision === "open").length;

  const counts = {
    open: openCount,
    decided: fileFindings.length - openCount,
    all: fileFindings.length,
  };

  const visible = fileFindings.filter((finding) => {
    if (category !== "all" && finding.category !== category) {
      return false;
    }

    if (method !== "all" && !finding.detections.some((detection) => detection.method === method)) {
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
    visible.find((finding) => finding.id === findingId) ??
    fileFindings.find((finding) => finding.id === findingId) ??
    visible[0] ??
    null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            target.closest('[role="dialog"]') ||
            target.closest('[role="listbox"]')))
      ) {
        return;
      }

      if (event.key === "n" || event.key === "p") {
        if (visible.length === 0) {
          return;
        }

        const index = visible.findIndex((finding) => finding.id === (selected?.id ?? ""));

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
      toast.error(decideError instanceof Error ? decideError.message : "Decision failed.");
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
      toast.error(excludeError instanceof Error ? excludeError.message : "Exclude failed.");
    } finally {
      setBusy(false);
    }
  }

  async function drawBox(box: Box, anchor?: string) {
    if (!selectedFile) {
      return;
    }

    setBusy(true);

    try {
      if (selected && needsDrawnBox(selected)) {
        await saveRegion(packageId, {
          action: "update",
          findingId: selected.id,
          box,
          anchor,
        });
      } else {
        await saveRegion(packageId, {
          action: "add",
          fileId: selectedFile.id,
          box,
          anchor,
          category: "other",
        });
      }

      await onRefresh();
    } catch (regionError) {
      toast.error(regionError instanceof Error ? regionError.message : "Box failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addSpan(start: number, end: number) {
    if (!selectedFile) {
      return;
    }

    setBusy(true);

    try {
      await saveRegion(packageId, {
        action: "add-span",
        fileId: selectedFile.id,
        start,
        end,
        category: "other",
      });
      await onRefresh();
    } catch (spanError) {
      toast.error(spanError instanceof Error ? spanError.message : "Finding failed.");
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
      toast.error(moveError instanceof Error ? moveError.message : "Move failed.");
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
      toast.error(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openRelated(finding: Finding) {
    try {
      const result = await findRelated(packageId, {
        term: quoteOf(finding) ?? finding.title,
      });

      setRelated(result);
      setRelatedOpen(true);
    } catch (relatedError) {
      toast.error(relatedError instanceof Error ? relatedError.message : "Search failed.");
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
      toast.error(groupError instanceof Error ? groupError.message : "Group failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFile) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>No files in this package</EmptyTitle>
          <EmptyDescription>
            Add files to the package, then scan it to start the review.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const needsBox = selected !== null && needsDrawnBox(selected);

  return (
    <div className="flex flex-col lg:h-full">
      {detail.warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2.5 border-b bg-warning-muted px-4 py-1.5 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <ul className="flex flex-col">
            {detail.warnings.map((warning, index) => (
              <li key={`${warning.term}-${warning.relatedGroupId}`}>
                {index === 0 && (
                  <span className="font-medium">
                    {plural(detail.warnings.length, "inconsistent redaction")}:{" "}
                  </span>
                )}
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_24rem]">
        <section
          aria-label="Files"
          className="flex min-h-0 flex-col border-b bg-sidebar lg:border-r lg:border-b-0"
        >
          <header className="flex h-10 shrink-0 items-center justify-between border-b px-4">
            <h2 className="text-sm font-medium">Files</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{files.length}</span>
          </header>
          <div className="max-h-72 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            <FileList
              files={files}
              findings={detail.findings}
              selectedId={selectedFile.id}
              onSelect={(id) => {
                setFileId(id);
                setFindingId(null);
              }}
            />
          </div>
        </section>

        <section aria-label="Document" className="flex min-h-0 min-w-0 flex-col bg-sheet">
          <header className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
            <h2 className="truncate font-mono text-[0.8125rem] font-medium">
              {selectedFile.originalName}
            </h2>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(selectedFile.sizeBytes)}
            </span>
          </header>
          <div className="min-h-[24rem] flex-1 overflow-auto lg:min-h-0">
            {selectedFile.kind === "text" && (
              <TextViewer
                key={selectedFile.id}
                fileUrl={originalFileUrl(packageId, selectedFile.id)}
                fileName={selectedFile.originalName}
                findings={fileFindings}
                selectedFindingId={selected?.id ?? null}
                onSelectFinding={setFindingId}
              />
            )}
            {selectedFile.kind === "image" && (
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
            )}
            {selectedFile.kind === "document" && documentError && (
              <p className="p-4 text-sm text-destructive">{documentError}</p>
            )}
            {selectedFile.kind === "document" && !documentError && !documentModel && (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            )}
            {documentModel?.format === "pdf" && (
              <PdfViewer
                key={selectedFile.id}
                model={documentModel}
                pageUrl={(page) => filePageUrl(packageId, selectedFile.id, page)}
                fileName={selectedFile.originalName}
                findings={fileFindings}
                selectedFindingId={selected?.id ?? null}
                needsBox={needsBox}
                onSelectFinding={setFindingId}
                onDraw={drawBox}
                onMove={moveBox}
                onDeleteBox={deleteBox}
              />
            )}
            {documentModel && documentModel.format !== "pdf" && (
              <DocumentViewer
                key={selectedFile.id}
                model={documentModel}
                findings={fileFindings}
                selectedFindingId={selected?.id ?? null}
                onSelectFinding={setFindingId}
                onAddSpan={addSpan}
              />
            )}
            {selectedFile.kind === "unsupported" && (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle>Not supported</EmptyTitle>
                  <EmptyDescription>
                    Cloak cannot read this file type. It is listed in coverage and is never
                    treated as reviewed. Exclude it, or check it yourself before you send.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </section>

        <section
          aria-label="Findings"
          className="flex min-h-0 flex-col border-t bg-sidebar lg:border-t-0 lg:border-l"
        >
          <header className="flex shrink-0 flex-col gap-2 border-b px-4 py-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Findings</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {openCount === 0
                  ? "No open findings in this file"
                  : `${openCount} open of ${fileFindings.length}`}
              </span>
            </div>
            <ToggleGroup
              value={[status]}
              onValueChange={(value: string[]) => {
                if (value[0]) {
                  setStatus(value[0]);
                  setFindingId(null);
                }
              }}
              spacing={0}
              size="sm"
              aria-label="Filter by decision"
              className="w-full rounded-md bg-muted p-0.5"
            >
              {statusFilters.map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className="flex-1 gap-1.5 rounded-[5px]! text-muted-foreground hover:bg-background/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                >
                  {item.label}
                  <span className="text-xs tabular-nums opacity-70">{counts[item.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {(categories.length > 1 || methods.length > 1) && (
              <div className="grid grid-cols-2 gap-1.5">
                <Select
                  value={category}
                  onValueChange={(value: string | null) => {
                    if (value !== null) {
                      setCategory(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Filter by category" className="w-full">
                    <SelectValue>
                      {(value: string) => {
                        const match = categories.find((item) => item === value);

                        return match ? categoryLabel(match) : "All categories";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {categoryLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
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
                  <SelectTrigger
                    size="sm"
                    aria-label="Filter by detection method"
                    className="w-full"
                  >
                    <SelectValue>
                      {(value: string) => {
                        const match = methods.find((item) => item === value);

                        return match ? methodLabel(match) : "All methods";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All methods</SelectItem>
                      {methods.map((item) => (
                        <SelectItem key={item} value={item}>
                          {methodLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
          </header>

          <div className="max-h-[32rem] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
            {visible.length === 0 && (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyTitle>
                    {status === "open" && fileFindings.length > 0
                      ? "Every finding in this file has a decision"
                      : "No findings match"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {status === "open" && fileFindings.length > 0
                      ? "Pick the next file with open findings, or show decided findings to change a decision."
                      : "Change the filters, or pick another file."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {visible.map((finding) => (
              <FindingRow
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

          <footer className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground lg:flex">
            <span className="flex items-center gap-1">
              <Kbd>N</Kbd>
              <Kbd>P</Kbd>
              Next, previous
            </span>
            <span className="flex items-center gap-1">
              <Kbd>R</Kbd>
              Redact
            </span>
            <span className="flex items-center gap-1">
              <Kbd>K</Kbd>
              Keep
            </span>
          </footer>
        </section>
      </div>

      <Dialog open={relatedOpen} onOpenChange={setRelatedOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Related occurrences</DialogTitle>
            <DialogDescription>
              {related ? (
                <>
                  Findings that refer to{" "}
                  <span className="font-mono text-foreground">“{related.term}”</span> in other files
                  of this package.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-4 overflow-y-auto">
            {(
              [
                ["Exact matches", related?.exact ?? []],
                ["Possible matches (AI suggestion)", related?.aiSuggestions ?? []],
              ] as const
            ).map(([title, list]) => (
              <section key={title} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {title} · {list.length}
                </h3>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="flex flex-col rounded-md border">
                    {list.map((finding) => (
                      <li
                        key={finding.id}
                        className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                      >
                        <span className="flex w-3.5 justify-center">
                          <DecisionMark decision={finding.decision} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{finding.title}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {fileNameOf(files, finding.fileId)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRelatedOpen(false)} disabled={busy}>
              Close
            </Button>
            <Button onClick={redactGroup} disabled={busy || !related || related.exact.length === 0}>
              Redact all exact matches
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
