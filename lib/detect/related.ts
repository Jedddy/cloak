import type { FindRelatedInput, InconsistentRedactionsInput } from "@/lib/contract/interfaces";
import type { Finding, FindingCandidate, PackageWarning } from "@/lib/contract/schemas";

import { scanTerm, slugTerm } from "./protected-terms";
import { ocrWordOffsets, unionBox } from "./rules";
import { lineAt } from "./structure";

// Package checks (overview section 13, plan R17-R18). Exact related search
// and the inconsistent-redaction warning. Pure functions over findings.

// Exact matches of a term in all text and OCR text, with evidence (plan R17).
export function findRelatedExact(input: FindRelatedInput): Promise<FindingCandidate[]> {
  const clean = input.term.trim();

  if (clean === "") {
    return Promise.resolve([]);
  }

  const relatedGroupId = slugTerm(clean);
  const candidates: FindingCandidate[] = [];

  for (const source of input.sources) {
    const offsets = source.ocrWords === null ? [] : ocrWordOffsets(source.ocrWords);

    for (const hit of scanTerm(source.text, clean)) {
      const overlapping = offsets
        .filter((item) => item.start < hit.end && item.end > hit.start)
        .map((item) => item.word);

      if (overlapping.length > 0) {
        candidates.push({
          fileId: source.fileId,
          category: "protected-term",
          detections: [
            {
              method: "protected-term",
              ruleId: null,
              evidence: [{ type: "image-region", box: unionBox(overlapping), quote: hit.quote }],
            },
          ],
          title: `Related: ${clean}`,
          reason: "Exact match of a related term.",
          relatedGroupId,
        });
      } else {
        candidates.push({
          fileId: source.fileId,
          category: "protected-term",
          detections: [
            {
              method: "protected-term",
              ruleId: null,
              evidence: [
                {
                  type: "text-span",
                  start: hit.start,
                  end: hit.end,
                  line: lineAt(source.text, hit.start),
                  quote: hit.quote,
                },
              ],
            },
          ],
          title: `Related: ${clean}`,
          reason: "Exact match of a related term.",
          relatedGroupId,
        });
      }
    }
  }

  return Promise.resolve(candidates);
}

function isVisible(finding: Finding): boolean {
  return finding.decision === "keep" || finding.decision === "keep-and-remember" || finding.decision === "open";
}

function quoteMatches(finding: Finding, term: string): boolean {
  const wanted = term.toLowerCase();

  return finding.detections.some((detection) =>
    detection.evidence.some(
      (evidence) =>
        (evidence.type === "text-span" || evidence.type === "image-region") &&
        evidence.quote !== null &&
        evidence.quote.toLowerCase() === wanted,
    ),
  );
}

function termForGroup(groupId: string, findings: Finding[], protectedTerms: string[]): string {
  for (const term of protectedTerms) {
    if (slugTerm(term.trim()) === groupId) {
      return term.trim();
    }
  }

  const titled = findings.find((finding) => finding.title.includes(": "))?.title;

  if (titled !== undefined) {
    return titled.slice(titled.indexOf(": ") + 2);
  }

  return groupId;
}

/** A warning for each group or term kept in one file and redacted in another (plan R18). */
export function inconsistentRedactions(input: InconsistentRedactionsInput): PackageWarning[] {
  const excluded = new Set(input.files.flatMap((file) => (file.excluded ? [file.id] : [])));
  const live = input.findings.filter((finding) => excluded.has(finding.fileId) === false);
  const names = new Map(input.files.map((file) => [file.id, file.originalName]));

  const grouped = new Map<string, Finding[]>();

  for (const finding of live) {
    if (finding.relatedGroupId === null) {
      continue;
    }

    grouped.set(finding.relatedGroupId, [...(grouped.get(finding.relatedGroupId) ?? []), finding]);
  }

  // Protected terms whose occurrences never got a group id still count:
  // they join by exact quote match under the term's slug.
  for (const term of input.protectedTerms) {
    const clean = term.trim();

    if (clean === "") {
      continue;
    }

    const groupId = slugTerm(clean);
    const orphans = live.filter((finding) => finding.relatedGroupId === null && quoteMatches(finding, clean));

    if (orphans.length > 0) {
      grouped.set(groupId, [...(grouped.get(groupId) ?? []), ...orphans]);
    }
  }

  const warnings: PackageWarning[] = [];

  for (const [groupId, findings] of grouped) {
    const redacted = [...new Set(findings.flatMap((finding) => (finding.decision === "redact" ? [finding.fileId] : [])))];
    const visible = [...new Set(findings.flatMap((finding) => (isVisible(finding) ? [finding.fileId] : [])))];

    if (redacted.length === 0 || visible.length === 0) {
      continue;
    }

    const term = termForGroup(groupId, findings, input.protectedTerms);
    const nameOf = (fileId: string): string => names.get(fileId) ?? fileId;

    warnings.push({
      type: "inconsistent-redaction",
      term,
      relatedGroupId: groupId,
      redactedFileIds: redacted,
      visibleFileIds: visible,
      message: `'${term}' is redacted in ${redacted.map((id) => nameOf(id)).join(", ")} but still visible in ${visible.map((id) => nameOf(id)).join(", ")}.`,
    });
  }

  return warnings;
}
