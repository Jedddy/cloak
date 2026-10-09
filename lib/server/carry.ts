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

      return `box:${round(x)},${round(y)},${round(w)},${round(h)}`;
    }

    case "image-whole":
      return "whole";
    case "file-structure":
      return `bytes:${evidence.byteOffset ?? "none"}`;
  }
}

function fingerprints(finding: FindingCandidate): Set<string> {
  return new Set(
    finding.detections.flatMap((detection) => detection.evidence.map((evidence) => `${finding.fileId}|${finding.category}|${fingerprint(evidence)}`)),
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
  const unmatched = previous.filter((finding) => !isManual(finding));
  const manual = previous.filter(isManual);

  const carried = candidates.map((candidate): Finding => {
    const keys = fingerprints(candidate);
    const index = unmatched.findIndex((finding) => [...fingerprints(finding)].some((key) => keys.has(key)));

    if (index === -1) {
      return { ...candidate, id: `fnd-${randomUUID()}`, decision: "open" };
    }

    const [match] = unmatched.splice(index, 1);

    return { ...candidate, id: match?.id ?? `fnd-${randomUUID()}`, decision: match?.decision ?? "open" };
  });

  return [...carried, ...manual];
}
