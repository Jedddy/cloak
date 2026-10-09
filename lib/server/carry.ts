import { randomUUID } from "node:crypto";

import type { Evidence, Finding, FindingCandidate, ProfiledCandidate } from "@/lib/contract/schemas";

// A rescan keeps user decisions for findings that still match (R15, KTD7).
// Two findings match when they have the same file and category and share
// at least one evidence fingerprint: a text span, an image box rounded to
// 4 px, or a structure byte offset.

function round(value: number): number {
  return Math.round(value / 4) * 4;
}

function fingerprint(evidence: Evidence): string {
  switch (evidence.type) {
    case "text-span":
      return `span:${evidence.start}-${evidence.end}`;
    case "image-region": {
      const { x, y, w, h } = evidence.box;

      const rounded = `${round(x)},${round(y)},${round(w)},${round(h)}`;

      return evidence.anchor ? `box:${evidence.anchor}:${rounded}` : `box:${rounded}`;
    }

    case "image-whole":
      return "whole";
    case "file-structure":
      if (evidence.anchor) {
        return `struct:${evidence.anchor}`;
      }

      return `bytes:${evidence.byteOffset ?? "none"}`;
  }
}

function fingerprints(finding: FindingCandidate): Set<string> {
  return new Set(
    finding.detections.flatMap((detection) => detection.evidence.map((evidence) => `${finding.fileId}|${finding.category}|${fingerprint(evidence)}`)),
  );
}

/** Same file, same category, and at least one shared evidence fingerprint. */
export function sharesEvidence(left: FindingCandidate, right: FindingCandidate): boolean {
  const keys = fingerprints(left);

  return [...fingerprints(right)].some((key) => keys.has(key));
}

/** The quoted text of every evidence entry that has one, in order. */
export function findingQuotes(finding: FindingCandidate): string[] {
  return finding.detections.flatMap((detection) =>
    detection.evidence.flatMap((evidence) => {
      const quote = evidence.type === "text-span" || evidence.type === "image-region" ? evidence.quote : null;

      return quote ? [quote] : [];
    }),
  );
}

function isManual(finding: Finding): boolean {
  return finding.detections.every((detection) => detection.method === "manual");
}

/**
 * Gives each new candidate an id and a decision. A match with an old
 * finding keeps its id and decision; other candidates start open. Old
 * findings with no match are dropped, except manual regions, which only
 * the user can remove.
 */
export function carryDecisions(candidates: ProfiledCandidate[], previous: Finding[]): Finding[] {
  const unmatched = previous.flatMap((finding) => (isManual(finding) ? [] : [{ finding, keys: fingerprints(finding) }]));
  const manual = previous.filter(isManual);

  const carried = candidates.map((candidate): Finding => {
    const keys = fingerprints(candidate);
    const index = unmatched.findIndex((entry) => [...entry.keys].some((key) => keys.has(key)));
    const match = index === -1 ? undefined : unmatched.splice(index, 1)[0]?.finding;

    if (match === undefined) {
      return { ...candidate, id: `fnd-${randomUUID()}`, decision: "open" };
    }

    // A box the user drew on a layer finding (for example image-whole) stays.
    const manualBoxes = match.detections.filter((detection) => detection.method === "manual");

    return { ...candidate, detections: [...candidate.detections, ...manualBoxes], id: match.id, decision: match.decision };
  });

  return [...carried, ...manual];
}
