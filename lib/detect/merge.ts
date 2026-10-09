import type { MergeInput } from "@/lib/contract/interfaces";
import type { FindingCandidate } from "@/lib/contract/schemas";

// Finding merge (overview section 12, plan R16). Findings with overlapping
// evidence and the same category join into one finding with one detection
// per layer. Each detection keeps its method and evidence. Rule detections
// win for title and reason.

function spansOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function boxesOverlap(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): boolean {
  return left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;
}

function candidatesOverlap(left: FindingCandidate, right: FindingCandidate): boolean {
  if (left.fileId !== right.fileId || left.category !== right.category) {
    return false;
  }

  for (const leftDetection of left.detections) {
    for (const rightDetection of right.detections) {
      for (const leftEvidence of leftDetection.evidence) {
        for (const rightEvidence of rightDetection.evidence) {
          if (leftEvidence.type === "text-span" && rightEvidence.type === "text-span") {
            if (spansOverlap(leftEvidence.start, leftEvidence.end, rightEvidence.start, rightEvidence.end)) {
              return true;
            }
          }

          if (leftEvidence.type === "image-region" && rightEvidence.type === "image-region") {
            if (boxesOverlap(leftEvidence.box, rightEvidence.box)) {
              return true;
            }
          }

          if (leftEvidence.type === "file-structure" && rightEvidence.type === "file-structure") {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function isRuleCandidate(candidate: FindingCandidate): boolean {
  return candidate.detections.some((detection) => detection.method === "rule" || detection.method === "ocr-rule");
}

/** Joins findings with overlapping evidence and the same category (plan R16). */
export function merge(input: MergeInput): FindingCandidate[] {
  const groups: FindingCandidate[][] = [];

  for (const candidate of input.candidates) {
    const group = groups.find((members) => members.some((member) => candidatesOverlap(member, candidate)));

    if (group === undefined) {
      groups.push([candidate]);
    } else {
      group.push(candidate);
    }
  }

  // The insertion above joins only the first overlapping group. Union every
  // pair of groups that still overlap so bridge order cannot split them.
  let joined = true;

  while (joined) {
    joined = false;

    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        const leftGroup = groups[left];
        const rightGroup = groups[right];

        if (leftGroup.some((a) => rightGroup.some((b) => candidatesOverlap(a, b)))) {
          leftGroup.push(...rightGroup);
          groups.splice(right, 1);
          joined = true;
          break;
        }
      }

      if (joined) {
        break;
      }
    }
  }

  return groups.map((members) => {
    const first = members[0];
    const winner = members.find((member) => isRuleCandidate(member)) ?? first;

    const seen = new Set<string>();

    const detections = members.flatMap((member) => member.detections).filter((detection) => {
      const key = `${detection.method}:${detection.ruleId ?? ""}:${JSON.stringify(detection.evidence)}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

    const relatedGroupId = members.map((member) => member.relatedGroupId).find((id) => id !== null) ?? null;

    return {
      fileId: first.fileId,
      category: first.category,
      detections,
      title: winner.title,
      reason: winner.reason,
      relatedGroupId,
    };
  });
}
