"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Decision, Evidence, Finding } from "@/lib/contract/schemas";

function whereOf(evidence: Evidence): string {
  if (evidence.type === "text-span") {
    return `line ${evidence.line + 1}`;
  }
  if (evidence.type === "image-region") {
    return "image region";
  }
  if (evidence.type === "image-whole") {
    return "whole image";
  }
  if (evidence.byteOffset === null) {
    return "file";
  }
  return `byte ${evidence.byteOffset}`;
}

function suggestedLabel(finding: Finding): string {
  if (finding.allowedByRecipient) {
    return "Allowed for this recipient";
  }
  if (finding.suggestedAction === "redact") {
    return "Suggested: redact";
  }
  if (finding.suggestedAction === "keep") {
    return "Suggested: keep";
  }
  return "Needs decision";
}

const decisions: { value: Decision; label: string }[] = [
  { value: "redact", label: "Redact" },
  { value: "keep", label: "Keep" },
  { value: "keep-and-remember", label: "Keep and remember" },
  { value: "not-an-issue", label: "Not an issue" },
];

export function FindingCard({
  finding,
  selected,
  disabled,
  onSelect,
  onDecide,
  onExcludeFile,
  onFindRelated,
}: {
  finding: Finding;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDecide: (decision: Decision) => void;
  onExcludeFile: () => void;
  onFindRelated: () => void;
}) {
  const methods = Array.from(
    new Set(finding.detections.map((detection) => detection.method)),
  );
  return (
    <article
      aria-current={selected}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm",
        selected && "border-primary bg-selection",
      )}
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-sm font-semibold">{finding.title}</h3>
      </div>
      <p className="text-muted-foreground">{finding.reason}</p>
      <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="font-medium">Where:</dt>
          <dd>{finding.detections.flatMap((detection) => detection.evidence).map(whereOf).join(" · ")}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-medium">Detected:</dt>
          <dd>{methods.join(", ")}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={finding.decision === "open" ? "outline" : "secondary"}
        >
          {finding.decision}
        </Badge>
        <Badge variant="outline">{suggestedLabel(finding)}</Badge>
        <Badge variant="outline">{finding.category}</Badge>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        {decisions.map((option) => (
          <Button
            key={option.value}
            variant={finding.decision === option.value ? "default" : "outline"}
            size="xs"
            disabled={disabled}
            onClick={() => onDecide(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={onFindRelated}
        >
          Find related
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={onExcludeFile}
        >
          Exclude file
        </Button>
      </div>
    </article>
  );
}
