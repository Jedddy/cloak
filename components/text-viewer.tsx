"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { Finding } from "@/lib/contract/schemas";

type Span = { start: number; end: number; findingId: string };

type Segment = { text: string; findingIds: string[] };

function segmentsOf(text: string, spans: Span[]): Segment[] {
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
      findingIds: spans.flatMap((span) =>
        span.start <= point && span.end >= next ? [span.findingId] : [],
      ),
    });
  }

  return segments;
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

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (text === null) {
    return <p className="text-sm text-muted-foreground">Loading file…</p>;
  }

  const spans: Span[] = findings.flatMap((finding) =>
    finding.detections.flatMap((detection) =>
      detection.evidence.flatMap((evidence) =>
        evidence.type === "text-span"
          ? [{ start: evidence.start, end: evidence.end, findingId: finding.id }]
          : [],
      ),
    ),
  );

  return (
    <pre className="font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words">
      {segmentsOf(text, spans).map((segment, index) => {
        if (segment.findingIds.length === 0) {
          return <span key={index}>{segment.text}</span>;
        }

        const selected = segment.findingIds.includes(selectedFindingId ?? "");

        return (
          <mark
            key={index}
            onClick={() => onSelectFinding(segment.findingIds[0])}
            className={cn(
              "cursor-pointer rounded-[3px] px-px",
              selected
                ? "bg-highlight text-foreground"
                : "bg-highlight/50 text-foreground",
            )}
          >
            {segment.text}
          </mark>
        );
      })}
    </pre>
  );
}
