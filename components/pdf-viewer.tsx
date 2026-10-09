"use client";

import { useEffect, useMemo, useRef } from "react";

import { ImageViewer, type TextBox } from "@/components/image-viewer";
import type { Box, DocumentModel, Finding } from "@/lib/contract/schemas";

/** Words on the same line when they share more than half of the shorter height. */
function sameLine(left: Box, right: Box): boolean {
  const overlap = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);

  return overlap > Math.min(left.h, right.h) / 2;
}

/** The text-span evidence of the findings as one box per line, grouped by page. */
function textBoxesByPage(model: DocumentModel, findings: Finding[]): Map<number, TextBox[]> {
  const byPage = new Map<number, TextBox[]>();

  for (const finding of findings) {
    for (const detection of finding.detections) {
      for (const evidence of detection.evidence) {
        if (evidence.type !== "text-span") {
          continue;
        }

        const lines: { page: number; box: Box }[] = [];

        for (const word of model.words) {
          if (word.end <= evidence.start || word.start >= evidence.end) {
            continue;
          }

          if (!word.anchor.startsWith("page:")) {
            continue;
          }

          const page = Number(word.anchor.slice("page:".length));
          const last = lines[lines.length - 1];

          if (last && last.page === page && sameLine(last.box, word.box)) {
            const x = Math.min(last.box.x, word.box.x);
            const y = Math.min(last.box.y, word.box.y);

            last.box = {
              x,
              y,
              w: Math.max(last.box.x + last.box.w, word.box.x + word.box.w) - x,
              h: Math.max(last.box.y + last.box.h, word.box.y + word.box.h) - y,
            };
          } else {
            lines.push({ page, box: word.box });
          }
        }

        for (const line of lines) {
          byPage.set(line.page, [
            ...(byPage.get(line.page) ?? []),
            { findingId: finding.id, box: line.box, decision: finding.decision },
          ]);
        }
      }
    }
  }

  return byPage;
}

/** The first page a finding has evidence on, or null. */
function pageOfFinding(model: DocumentModel, finding: Finding | undefined): number | null {
  for (const evidence of finding?.detections.flatMap((detection) => detection.evidence) ?? []) {
    if (evidence.type === "text-span") {
      const word = model.words.find(
        (item) =>
          item.anchor.startsWith("page:") && item.end > evidence.start && item.start < evidence.end,
      );

      if (word) {
        return Number(word.anchor.slice("page:".length));
      }
    } else if (evidence.anchor?.startsWith("page:")) {
      return Number(evidence.anchor.slice("page:".length));
    }
  }

  return null;
}

export function PdfViewer({
  model,
  pageUrl,
  fileName,
  findings,
  selectedFindingId,
  needsBox,
  onSelectFinding,
  onDraw,
  onMove,
  onDeleteBox,
}: {
  model: DocumentModel;
  pageUrl: (page: number) => string;
  fileName: string;
  findings: Finding[];
  selectedFindingId: string | null;
  needsBox: boolean;
  onSelectFinding: (findingId: string) => void;
  onDraw: (box: Box, anchor: string) => void;
  onMove: (findingId: string, box: Box) => void;
  onDeleteBox: (findingId: string) => void;
}) {
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const textBoxes = useMemo(() => textBoxesByPage(model, findings), [model, findings]);

  const selected = findings.find((finding) => finding.id === selectedFindingId);
  const selectedPage = pageOfFinding(model, selected);

  useEffect(() => {
    if (selectedPage !== null) {
      pageRefs.current.get(selectedPage)?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedFindingId, selectedPage]);

  return (
    <div className="flex flex-col divide-y">
      {model.pages.map((_, index) => {
        const page = index + 1;
        const anchor = `page:${page}`;

        // A finding that only has a whole-page region asks for a box on that page.
        const pageNeedsBox =
          needsBox &&
          (selected?.detections.some((detection) =>
            detection.evidence.some(
              (evidence) => evidence.type === "image-whole" && evidence.anchor === anchor,
            ),
          ) ??
            false);

        return (
          <section
            key={page}
            aria-label={`Page ${page}`}
            ref={(node) => {
              if (node) {
                pageRefs.current.set(page, node);
              } else {
                pageRefs.current.delete(page);
              }
            }}
          >
            <ImageViewer
              imageUrl={pageUrl(page)}
              fileName={`${fileName}, page ${page}`}
              label={`Page ${page}`}
              anchor={anchor}
              findings={findings}
              textBoxes={textBoxes.get(page) ?? []}
              selectedFindingId={selectedFindingId}
              needsBox={pageNeedsBox}
              onSelectFinding={onSelectFinding}
              onDraw={(box) => onDraw(box, anchor)}
              onMove={onMove}
              onDeleteBox={onDeleteBox}
            />
          </section>
        );
      })}
    </div>
  );
}
