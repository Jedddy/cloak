"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Decision, Finding } from "@/lib/contract/schemas";
import { categoryLabel, cn, decisionLabel, methodLabel, quoteOf, whereOf } from "@/lib/utils";
import { Check, FileX, Minus, RotateCcw, Search } from "lucide-react";

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

/** A small glyph for the decision: open ring, solid redaction, check, or dash. */
export function DecisionMark({ decision }: { decision: Decision }) {
  if (decision === "redact") {
    return (
      <span
        aria-hidden="true"
        className="block h-2.5 w-3.5 rounded-[2px] bg-redaction ring-1 ring-foreground/15"
      />
    );
  }

  if (decision === "keep" || decision === "keep-and-remember") {
    return <Check aria-hidden="true" className="size-3.5 text-muted-foreground" />;
  }

  if (decision === "not-an-issue") {
    return <Minus aria-hidden="true" className="size-3.5 text-muted-foreground" />;
  }

  return (
    <span
      aria-hidden="true"
      className="block size-2.5 rounded-full border-[1.5px] border-warning"
    />
  );
}

const decisions: { value: Decision; label: string; key?: string }[] = [
  { value: "redact", label: "Redact", key: "R" },
  { value: "keep", label: "Keep", key: "K" },
  { value: "keep-and-remember", label: "Keep and remember" },
  { value: "not-an-issue", label: "Not an issue" },
];

export function FindingRow({
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
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  const evidence = finding.detections.flatMap((detection) => detection.evidence);
  const where = Array.from(new Set(evidence.map(whereOf))).join(", ");
  const quote = quoteOf(finding);

  const note = evidence.find(
    (item) => item.type === "image-whole" || item.type === "file-structure",
  );

  const methods = Array.from(
    new Set(finding.detections.map((detection) => methodLabel(detection.method))),
  );

  const decided = finding.decision !== "open";

  return (
    <article
      ref={ref}
      aria-current={selected}
      aria-label={finding.title}
      className={cn(
        "group/finding border-b transition-colors duration-150 last:border-b-0",
        selected ? "bg-selection" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
          <DecisionMark decision={finding.decision} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                "truncate text-sm font-medium",
                decided && !selected && "text-muted-foreground",
              )}
            >
              {finding.title}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {categoryLabel(finding.category)}
            </span>
          </span>
          {!selected && (
            <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
              {quote && <span className="truncate font-mono">{quote}</span>}
              {quote && <span aria-hidden="true">·</span>}
              <span className="shrink-0">{decided ? decisionLabel(finding.decision) : where}</span>
            </span>
          )}
        </span>
      </button>

      {selected && (
        <div className="flex flex-col gap-3 pr-4 pb-4 pl-[2.625rem]">
          <p className="text-sm text-pretty text-foreground/85">{finding.reason}</p>

          {(quote || note) && (
            <div className="rounded-md border bg-sheet px-3 py-2">
              {quote ? (
                <p className="font-mono text-[0.8125rem] break-all">
                  <mark className="rounded-[2px] bg-highlight px-0.5 text-foreground">{quote}</mark>
                </p>
              ) : (
                note && "note" in note && <p className="text-sm">{note.note}</p>
              )}
            </div>
          )}

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Where</dt>
            <dd>{where}</dd>
            <dt className="text-muted-foreground">Detected by</dt>
            <dd>{methods.join(", ")}</dd>
            <dt className="text-muted-foreground">Profile</dt>
            <dd>{suggestedLabel(finding)}</dd>
          </dl>

          <div role="group" aria-label="Decision" className="grid grid-cols-2 gap-1.5">
            {decisions.map((option) => {
              const current = finding.decision === option.value;

              const blocked = option.value === "keep-and-remember" && finding.category === "secret";

              return (
                <Button
                  key={option.value}
                  variant={current ? "default" : "outline"}
                  size="sm"
                  aria-pressed={current}
                  disabled={disabled || blocked}
                  title={blocked ? "A secret is never remembered as allowed." : undefined}
                  className="justify-between"
                  onClick={() => onDecide(option.value)}
                >
                  <span className="flex items-center gap-1.5">
                    {current && <Check data-icon="inline-start" />}
                    {option.label}
                  </span>
                  {option.key && !current && (
                    <Kbd className="h-4 min-w-4 bg-transparent px-0.5 text-[0.65rem]">
                      {option.key}
                    </Kbd>
                  )}
                </Button>
              );
            })}
          </div>

          <div className="-ml-2 flex flex-wrap items-center gap-0.5">
            {decided && (
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => onDecide("open")}
              >
                <RotateCcw data-icon="inline-start" />
                Reopen
              </Button>
            )}
            <Button variant="ghost" size="xs" disabled={disabled} onClick={onFindRelated}>
              <Search data-icon="inline-start" />
              Find related
            </Button>
            <Button variant="ghost" size="xs" disabled={disabled} onClick={onExcludeFile}>
              <FileX data-icon="inline-start" />
              Exclude file
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
