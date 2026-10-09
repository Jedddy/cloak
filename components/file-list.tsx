"use client";

import type { FileEntry, Finding } from "@/lib/contract/schemas";
import { cn, formatBytes, openFindingsOf } from "@/lib/utils";
import { Check, FileQuestion, FileText, Image as ImageIcon, OctagonX } from "lucide-react";

function aiNote(file: FileEntry): string | null {
  if (file.aiAnalysis === "done" || file.kind === "unsupported") {
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

function FileIcon({ file }: { file: FileEntry }) {
  if (file.status === "failed") {
    return <OctagonX className="size-4 text-destructive" />;
  }

  if (file.kind === "unsupported") {
    return <FileQuestion className="size-4 text-warning" />;
  }

  if (file.kind === "image") {
    return <ImageIcon className="size-4 text-muted-foreground" />;
  }

  return <FileText className="size-4 text-muted-foreground" />;
}

/** The file column of the Review and Preview screens. */
export function FileList({
  files,
  findings,
  selectedId,
  onSelect,
}: {
  files: FileEntry[];
  findings: Finding[];
  selectedId: string;
  onSelect: (fileId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-px p-2">
      {files.map((file) => {
        const open = openFindingsOf(findings, file.id);
        const note = aiNote(file);
        const active = file.id === selectedId;
        const reviewed = file.status === "processed" && open === 0;

        return (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => onSelect(file.id)}
              aria-current={active}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                active && "bg-selection hover:bg-selection",
                file.excluded && "opacity-60",
              )}
            >
              <span className="mt-0.5 shrink-0">
                <FileIcon file={file} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "truncate font-mono text-[0.8125rem]",
                    file.excluded && "line-through",
                  )}
                >
                  {file.originalName}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(file.sizeBytes)}
                  {file.excluded && " · Excluded from export"}
                  {file.kind === "unsupported" && " · Not supported"}
                </span>
                {file.status === "failed" && file.failureReason && (
                  <span className="text-xs text-destructive">{file.failureReason}</span>
                )}
                {note && file.status !== "failed" && (
                  <span className="text-xs text-warning">{note}</span>
                )}
              </span>
              {open > 0 && (
                <span
                  className="mt-px shrink-0 rounded-sm bg-foreground/[0.07] px-1.5 text-xs leading-5 font-medium tabular-nums"
                  title={`${open} open findings`}
                >
                  {open}
                </span>
              )}
              {reviewed && !file.excluded && (
                <Check
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-label="No open findings"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
