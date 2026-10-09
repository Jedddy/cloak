"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Box, Finding } from "@/lib/contract/schemas";

type PlacedBox = { findingId: string; box: Box; index: number };

type Fraction = { x: number; y: number; w: number; h: number };

function toFraction(box: Box, natural: { w: number; h: number }): Fraction {
  return {
    x: box.x / natural.w,
    y: box.y / natural.h,
    w: box.w / natural.w,
    h: box.h / natural.h,
  };
}

function toPixels(rect: Fraction, natural: { w: number; h: number }): Box {
  return {
    x: Math.max(0, Math.round(rect.x * natural.w)),
    y: Math.max(0, Math.round(rect.y * natural.h)),
    w: Math.max(1, Math.round(rect.w * natural.w)),
    h: Math.max(1, Math.round(rect.h * natural.h)),
  };
}

function styleOf(rect: Fraction): CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

export function ImageViewer({
  imageUrl,
  fileName,
  findings,
  selectedFindingId,
  needsBox,
  onSelectFinding,
  onDraw,
  onMove,
  onDeleteBox,
}: {
  imageUrl: string;
  fileName: string;
  findings: Finding[];
  selectedFindingId: string | null;
  needsBox: boolean;
  onSelectFinding: (findingId: string) => void;
  onDraw: (box: Box) => void;
  onMove: (findingId: string, box: Box) => void;
  onDeleteBox: (findingId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [drawRect, setDrawRect] = useState<Fraction | null>(null);
  const [dragOverride, setDragOverride] = useState<PlacedBox | null>(null);
  const [drag, setDrag] = useState<{
    findingId: string;
    index: number;
    startX: number;
    startY: number;
    origin: Fraction;
    moved: boolean;
  } | null>(null);
  const drawing = useRef(false);

  const placed: PlacedBox[] = findings.flatMap((finding) =>
    finding.detections.flatMap((detection) =>
      detection.evidence.flatMap((evidence, index) =>
        evidence.type === "image-region"
          ? [{ findingId: finding.id, box: evidence.box, index }]
          : [],
      ),
    ),
  );

  const drawActive = tool === "draw" || (needsBox && tool === "select");

  function pointOf(event: ReactPointerEvent): Fraction | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      w: 0,
      h: 0,
    };
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (!natural) {
      return;
    }
    const point = pointOf(event);
    if (!point) {
      return;
    }
    if (tool === "draw" || needsBox) {
      drawing.current = true;
      setDrawRect({ ...point, w: 0, h: 0 });
      containerRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    // SAFETY: pointer events on the viewer container always target an element inside it.
    const target = (event.target as HTMLElement).closest("[data-box]");
    if (!target) {
      return;
    }
    const findingId = target.getAttribute("data-finding") ?? "";
    const index = Number(target.getAttribute("data-index") ?? "0");
    const current = placed.find(
      (item) => item.findingId === findingId && item.index === index,
    );
    if (!current) {
      return;
    }
    setDrag({
      findingId,
      index,
      startX: point.x,
      startY: point.y,
      origin: toFraction(current.box, natural),
      moved: false,
    });
    containerRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!natural) {
      return;
    }
    const point = pointOf(event);
    if (!point) {
      return;
    }
    if (drawing.current && drawRect) {
      setDrawRect({
        x: Math.min(drawRect.x, point.x),
        y: Math.min(drawRect.y, point.y),
        w: Math.abs(point.x - drawRect.x),
        h: Math.abs(point.y - drawRect.y),
      });
      return;
    }
    if (drag) {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) * 100 < 0.5) {
        return;
      }
      setDrag({ ...drag, moved: true });
      const movedBox: PlacedBox = {
        findingId: drag.findingId,
        index: drag.index,
        box: toPixels(
          {
            x: drag.origin.x + dx,
            y: drag.origin.y + dy,
            w: drag.origin.w,
            h: drag.origin.h,
          },
          natural,
        ),
      };
      setDragOverride(movedBox);
    }
  }

  function onPointerUp() {
    if (drawing.current && drawRect && natural) {
      drawing.current = false;
      if (drawRect.w > 0.005 && drawRect.h > 0.005) {
        onDraw(toPixels(drawRect, natural));
      }
      setDrawRect(null);
      setTool("select");
      return;
    }
    if (drag) {
      if (drag.moved && dragOverride) {
        onMove(drag.findingId, dragOverride.box);
      } else {
        onSelectFinding(drag.findingId);
      }
      setDrag(null);
      setDragOverride(null);
    }
  }

  const visible = dragOverride
    ? placed.map((item) =>
        item.findingId === dragOverride.findingId &&
        item.index === dragOverride.index
          ? dragOverride
          : item,
      )
    : placed;

  const selectedHasBox = findings.some(
    (finding) =>
      finding.id === selectedFindingId &&
      finding.detections.some((detection) =>
        detection.evidence.some((evidence) => evidence.type === "image-region"),
      ),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant={tool === "draw" ? "default" : "outline"}
          size="xs"
          onClick={() => setTool(tool === "draw" ? "select" : "draw")}
        >
          Draw box
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={!selectedFindingId || !selectedHasBox}
          onClick={() => {
            if (selectedFindingId) {
              onDeleteBox(selectedFindingId);
            }
          }}
        >
          Delete box
        </Button>
        {needsBox && (
          <span className="text-xs text-muted-foreground">
            This finding needs a region: drag over the image to draw it.
          </span>
        )}
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-sheet">
        <div
          ref={containerRef}
          className={cn(
            "relative inline-block max-w-none align-top",
            drawActive ? "cursor-crosshair" : "cursor-default",
          )}
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={fileName}
            className="block max-h-[60vh] w-auto max-w-full"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {natural &&
            visible.map((item) => {
              const rect =
                dragOverride &&
                dragOverride.findingId === item.findingId &&
                dragOverride.index === item.index
                  ? toFraction(dragOverride.box, natural)
                  : toFraction(item.box, natural);
              const selected = item.findingId === selectedFindingId;
              return (
                <div
                  key={`${item.findingId}-${item.index}`}
                  data-box
                  data-finding={item.findingId}
                  data-index={item.index}
                  className={cn(
                    "absolute border-2",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-redaction/70 bg-redaction/10",
                  )}
                  style={styleOf(rect)}
                />
              );
            })}
          {drawRect && natural && (
            <div
              className="absolute border-2 border-dashed border-primary bg-primary/10"
              style={styleOf(drawRect)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
