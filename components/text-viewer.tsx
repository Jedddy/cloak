"use client";

import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Decision, Finding } from "@/lib/contract/schemas";

export type Span = { start: number; end: number; findingId: string; decision: Decision };

export type Segment = { text: string; spans: Span[] };

export function segmentsOf(text: string, spans: Span[]): Segment[] {
  const points = new Set<number>([0, text.length]);

  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start, text.length));
    const end = Math.max(0, Math.min(span.end, text.length));

    if (start < end) {
      points.add(start);
      points.add(end);
    }
  }

  const sorted = Array.from(points).sort((left, right) => left - right);
  const segments: Segment[] = [];

  for (const [index, point] of sorted.entries()) {
    const next = sorted[index + 1];

    if (next === undefined || next <= point) {
      continue;
    }

    segments.push({
      text: text.slice(point, next),
      spans: spans.filter((span) => span.start <= point && span.end >= next),
    });
  }

  return segments;
}

/** Splits segments at line breaks so that each line gets its own gutter number. */
function linesOf(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];

  for (const segment of segments) {
    const parts = segment.text.split("\n");

    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        lines.push([]);
      }

      if (part !== "") {
        lines[lines.length - 1].push({ text: part, spans: segment.spans });
      }
    }
  }

  return lines;
}

/** A highlighted run of text: one or more findings overlap it. */
export function SegmentMark({
  segment,
  selectedFindingId,
  onSelectFinding,
  markRef,
}: {
  segment: Segment;
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
  markRef?: (node: HTMLElement | null) => void;
}) {
  const selected = segment.spans.some((span) => span.findingId === selectedFindingId);

  const redacted = segment.spans.every((span) => span.decision === "redact");

  const settled = segment.spans.every(
    (span) => span.decision !== "open" && span.decision !== "redact",
  );

  return (
    <mark
      ref={markRef}
      data-selected={selected}
      onClick={() => onSelectFinding(segment.spans[0].findingId)}
      title={redacted ? "Approved redaction" : undefined}
      className={cn(
        "cursor-pointer rounded-[2px] bg-highlight/55 text-foreground transition-colors duration-150",
        settled &&
          "bg-transparent underline decoration-muted-foreground/50 decoration-dotted underline-offset-4",
        redacted && "bg-redaction text-transparent",
        selected && "bg-highlight text-foreground shadow-[inset_0_-2px_0_var(--primary)]",
      )}
    >
      {segment.text}
    </mark>
  );
}

export function TextViewer({
  fileUrl,
  fileName,
  findings,
  selectedFindingId,
  onSelectFinding,
}: {
  fileUrl: string;
  fileName: string;
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let stale = false;

    fetch(fileUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${fileName}.`);
        }

        return response.text();
      })
      .then((loaded) => {
        if (!stale) {
          setText(loaded);
        }
      })
      .catch((loadError: Error) => {
        if (!stale) {
          setError(loadError.message);
        }
      });

    return () => {
      stale = true;
    };
  }, [fileUrl, fileName]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedFindingId, text]);

  if (error) {
    return <p className="p-4 text-sm text-destructive">{error}</p>;
  }

  if (text === null) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    );
  }

  const spans: Span[] = findings.flatMap((finding) =>
    finding.detections.flatMap((detection) =>
      detection.evidence.flatMap((evidence) =>
        evidence.type === "text-span"
          ? [
              {
                start: evidence.start,
                end: evidence.end,
                findingId: finding.id,
                decision: finding.decision,
              },
            ]
          : [],
      ),
    ),
  );

  const lines = linesOf(segmentsOf(text, spans));
  let firstSelected = "";

  for (const [lineIndex, line] of lines.entries()) {
    const index = line.findIndex((segment) =>
      segment.spans.some((span) => span.findingId === selectedFindingId),
    );

    if (index !== -1) {
      firstSelected = `${lineIndex}:${index}`;
      break;
    }
  }

  return (
    <div className="py-3 font-mono text-[0.8125rem] leading-6">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} className="grid grid-cols-[3.25rem_minmax(0,1fr)]">
          <span
            aria-hidden="true"
            className="pr-4 text-right text-muted-foreground/70 tabular-nums select-none"
          >
            {lineIndex + 1}
          </span>
          <span className="pr-4 break-words whitespace-pre-wrap">
            {line.length === 0 && "\u200b"}
            {line.map((segment, index) => {
              if (segment.spans.length === 0) {
                return <span key={index}>{segment.text}</span>;
              }

              const isFirstSelected = firstSelected === `${lineIndex}:${index}`;

              return (
                <SegmentMark
                  key={index}
                  segment={segment}
                  selectedFindingId={selectedFindingId}
                  onSelectFinding={onSelectFinding}
                  markRef={
                    isFirstSelected
                      ? (node) => {
                          selectedRef.current = node;
                        }
                      : undefined
                  }
                />
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
