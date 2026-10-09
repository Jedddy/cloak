"use client";

import { useEffect, useRef, useState } from "react";

import { SegmentMark, segmentsOf, type Span } from "@/components/text-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DocumentModel, DocumentSection, Finding } from "@/lib/contract/schemas";
import { cn } from "@/lib/utils";
import { TextSelect } from "lucide-react";

type Item = DocumentSection["items"][number];

/** A1-style column letters for a zero-based column. */
function columnName(col: number): string {
  let name = "";

  for (let rest = col + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }

  return name;
}

/** The model text offset of a point in the view, or null outside every item. */
function offsetOf(container: HTMLElement, node: Node, offset: number): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const item = element?.closest("[data-start]");

  if (!item || !container.contains(item)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(item);
  range.setEnd(node, offset);

  return Number(item.getAttribute("data-start")) + range.toString().length;
}

function ItemText({
  model,
  item,
  spans,
  selectedFindingId,
  onSelectFinding,
}: {
  model: DocumentModel;
  item: Item;
  spans: Span[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  const local = spans
    .filter((span) => span.start < item.end && span.end > item.start)
    .map((span) => ({ ...span, start: span.start - item.start, end: span.end - item.start }));

  return segmentsOf(model.text.slice(item.start, item.end), local).map((segment, index) => {
    if (segment.spans.length === 0) {
      return <span key={index}>{segment.text}</span>;
    }

    return (
      <SegmentMark
        key={index}
        segment={segment}
        selectedFindingId={selectedFindingId}
        onSelectFinding={onSelectFinding}
      />
    );
  });
}

function SectionBody({
  model,
  section,
  spans,
  selectedFindingId,
  onSelectFinding,
}: {
  model: DocumentModel;
  section: DocumentSection;
  spans: Span[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  if (section.kind !== "grid") {
    return (
      <div className="flex flex-col gap-2">
        {section.items.map((item) => (
          <p
            key={item.start}
            data-start={item.start}
            className="text-sm leading-6 break-words whitespace-pre-wrap"
          >
            <ItemText
              model={model}
              item={item}
              spans={spans}
              selectedFindingId={selectedFindingId}
              onSelectFinding={onSelectFinding}
            />
          </p>
        ))}
      </div>
    );
  }

  const columns = Math.max(0, ...section.items.map((item) => (item.col ?? 0) + 1));

  const rows = Array.from(new Set(section.items.map((item) => item.row ?? 0))).sort(
    (left, right) => left - right,
  );

  return (
    <ScrollArea className="w-full">
      <Table className="font-mono text-[0.8125rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            {Array.from({ length: columns }, (_, col) => (
              <TableHead key={col}>{columnName(col)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row}>
              <TableHead className="text-right tabular-nums">{row + 1}</TableHead>
              {Array.from({ length: columns }, (_, col) => {
                const item = section.items.find(
                  (candidate) => (candidate.row ?? 0) === row && (candidate.col ?? 0) === col,
                );

                if (!item) {
                  return <TableCell key={col} />;
                }

                return (
                  <TableCell
                    key={col}
                    data-start={item.start}
                    title={item.label}
                    className="break-words whitespace-pre-wrap"
                  >
                    <ItemText
                      model={model}
                      item={item}
                      spans={spans}
                      selectedFindingId={selectedFindingId}
                      onSelectFinding={onSelectFinding}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

export function DocumentViewer({
  model,
  findings,
  selectedFindingId,
  onSelectFinding,
  onAddSpan,
}: {
  model: DocumentModel;
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
  /** Without it the view is read-only: no selection, no Add finding. */
  onAddSpan?: (start: number, end: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  const [picked, setPicked] = useState<{ forFinding: string | null; index: number }>({
    forFinding: null,
    index: 0,
  });

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

  // Sheets are tabs. A tab the user picked stays until another finding is selected.
  const selectedStart = spans.find((span) => span.findingId === selectedFindingId)?.start;

  const selectedSection = model.sections.findIndex((section) =>
    section.items.some(
      (item) =>
        selectedStart !== undefined && item.start <= selectedStart && selectedStart < item.end,
    ),
  );

  const activeTab =
    picked.forFinding === selectedFindingId || selectedSection === -1
      ? picked.index
      : selectedSection;

  useEffect(() => {
    containerRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedFindingId, activeTab]);

  useEffect(() => {
    function onSelectionChange() {
      const container = containerRef.current;
      const current = document.getSelection();

      if (!container || !current || current.rangeCount === 0) {
        return;
      }

      const range = current.getRangeAt(0);

      if (!container.contains(range.commonAncestorContainer)) {
        return;
      }

      const start = offsetOf(container, range.startContainer, range.startOffset);
      const end = offsetOf(container, range.endContainer, range.endOffset);

      if (range.collapsed || start === null || end === null) {
        setSelection(null);

        return;
      }

      // Trim the line breaks that a drag across items picks up.
      const picked = model.text.slice(start, end);
      const lead = picked.length - picked.trimStart().length;

      if (lead === picked.length) {
        setSelection(null);

        return;
      }

      setSelection({ start: start + lead, end: end - (picked.length - picked.trimEnd().length) });
    }

    document.addEventListener("selectionchange", onSelectionChange);

    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [model.text]);

  const body = (section: DocumentSection) => (
    <SectionBody
      model={model}
      section={section}
      spans={spans}
      selectedFindingId={selectedFindingId}
      onSelectFinding={onSelectFinding}
    />
  );

  const tabbed = model.format === "xlsx";

  return (
    <div className="flex flex-col">
      {onAddSpan && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b bg-sheet/95 px-3 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={selection === null}
            onClick={() => {
              if (selection && onAddSpan) {
                onAddSpan(selection.start, selection.end);
                document.getSelection()?.removeAllRanges();
                setSelection(null);
              }
            }}
          >
            <TextSelect data-icon="inline-start" />
            Add finding
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {selection
              ? `Selected: ${model.text.slice(selection.start, selection.end)}`
              : "Select text in the document to add it as a finding."}
          </span>
        </div>
      )}

      <div ref={containerRef} className="p-4">
        {tabbed && (
          <Tabs
            value={String(activeTab)}
            onValueChange={(value) =>
              setPicked({ forFinding: selectedFindingId, index: Number(value) })
            }
          >
            <div className="max-w-full overflow-x-auto">
              <TabsList variant="line">
                {model.sections.map((section, index) => (
                  <TabsTrigger key={index} value={String(index)}>
                    {section.title}
                    {section.hidden && <Badge variant="outline">Hidden</Badge>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {model.sections.map((section, index) => (
              <TabsContent key={index} value={String(index)}>
                {body(section)}
              </TabsContent>
            ))}
          </Tabs>
        )}
        {!tabbed && (
          <div className="flex flex-col gap-6">
            {model.sections.map((section, index) => (
              <section
                key={index}
                aria-label={section.title}
                className={cn(
                  "flex flex-col gap-2",
                  section.title.endsWith(" notes") && "border-l pl-4",
                )}
              >
                <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {section.title}
                  {section.hidden && <Badge variant="outline">Hidden</Badge>}
                </h3>
                {body(section)}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
