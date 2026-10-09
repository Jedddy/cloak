export { cn } from "cn";

import type {
  Category,
  Decision,
  DetectionMethod,
  Evidence,
  FileEntry,
  Finding,
  Locality,
  Mode,
} from "@/lib/contract/schemas";

const categoryLabels: Record<Category, string> = {
  secret: "Secret",
  "personal-contact": "Personal contact",
  "personal-id": "Personal ID",
  "other-client": "Other client",
  "protected-term": "Protected term",
  "internal-pricing": "Internal pricing",
  "internal-infra": "Internal infrastructure",
  "unreleased-work": "Unreleased work",
  metadata: "Metadata",
  "hidden-data": "Hidden data",
  "prompt-injection": "Instruction-like text",
  other: "Other",
};

export function categoryLabel(category: Category): string {
  return categoryLabels[category];
}

const methodLabels: Record<DetectionMethod, string> = {
  rule: "Rule",
  "protected-term": "Protected term",
  "ocr-rule": "OCR and rule",
  "llm-text": "AI text",
  "llm-vision": "AI vision",
  structure: "Structure check",
  manual: "Manual box",
};

export function methodLabel(method: DetectionMethod): string {
  return methodLabels[method];
}

const decisionLabels: Record<Decision, string> = {
  open: "Open",
  redact: "Redact",
  keep: "Keep",
  "keep-and-remember": "Keep and remember",
  "not-an-issue": "Not an issue",
};

export function decisionLabel(decision: Decision): string {
  return decisionLabels[decision];
}

/** "rules-only" → "Rules only": sentence case for status slugs. */
export function sentenceCase(slug: string): string {
  const text = slug.replaceAll("-", " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "3 files", "1 file". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The file name for an id, so that reports never show raw ids. */
export function fileNameOf(files: FileEntry[], fileId: string): string {
  return files.find((file) => file.id === fileId)?.originalName ?? fileId;
}

/** Where a piece of evidence is, in words: "line 3", "image region". */
export function whereOf(evidence: Evidence): string {
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
    return "file structure";
  }

  return `byte ${evidence.byteOffset}`;
}

/** True when text has a visible character (zero-width characters do not count). */
function visible(text: string): boolean {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim() !== "";
}

/** The first visible exact quote of a finding, for evidence previews. */
export function quoteOf(finding: Finding): string | null {
  for (const detection of finding.detections) {
    for (const evidence of detection.evidence) {
      if (evidence.type === "text-span" && visible(evidence.quote)) {
        return evidence.quote;
      }

      if (evidence.type === "image-region" && evidence.quote && visible(evidence.quote)) {
        return evidence.quote;
      }
    }
  }

  return null;
}

export function openFindingsOf(findings: Finding[], fileId?: string): number {
  return findings.filter(
    (finding) =>
      finding.decision === "open" &&
      (fileId === undefined || finding.fileId === fileId),
  ).length;
}

/** "482.1 KB", "5.0 KB": file sizes in lists use one decimal unit. */
export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unit = units[0];

  for (const next of units.slice(1)) {
    if (value < 1024) {
      break;
    }

    value /= 1024;
    unit = next;
  }

  return `${value.toFixed(1)} ${unit}`;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Local date and time for package lists: "Oct 9, 10:01 PM". */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function modeLabel(mode: Mode): string {
  if (mode === "full") {
    return "Full";
  }

  if (mode === "text-ai") {
    return "Text AI";
  }

  return "Rules only";
}

export function localityLabel(locality: Locality): string {
  if (locality === "local") {
    return "Local";
  }

  if (locality === "lan") {
    return "LAN";
  }

  if (locality === "remote") {
    return "Remote";
  }

  return "Mock";
}

/** Hostname of a model URL, for the locality badge and dialogs. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Text for comparing needles: trimmed, whitespace collapsed to single spaces, lowercased. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The spreadsheet column name of a 1-based column number: 1 is "A", 27 is "AA". */
export function columnName(oneBased: number): string {
  let name = "";

  for (let rest = oneBased; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }

  return name;
}

/** The 1-based column number of a column name (any case): "A" is 1, "AA" is 27. */
export function columnNumber(letters: string): number {
  let number = 0;

  for (const letter of letters.toUpperCase()) {
    number = number * 26 + letter.charCodeAt(0) - 64;
  }

  return number;
}
