import type { ProtectedTermsInput } from "@/lib/contract/interfaces";
import type { FindingCandidate, OcrWord } from "@/lib/contract/schemas";

import { ocrWordOffsets, unionBox } from "./rules";
import { lineAt } from "./structure";

// Protected terms and other clients (overview section 11 layer 3, plan
// R13). Case-insensitive exact matches on word boundaries, in text and
// OCR text. Multi-word terms match word sequences; the box is the union
// of the word boxes. Each term keeps one shared relatedGroupId.

export function slugTerm(term: string): string {
  const slug = term
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  return `rel-${slug === "" ? "term" : slug}`;
}

function escapeRegExp(term: string): string {
  return term.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&");
}

export type TermEntry = {
  term: string;
  category: "protected-term" | "other-client";
  title: string;
  reason: string;
};

function termPattern(term: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "giu");
}

export type TermHit = {
  start: number;
  end: number;
  quote: string;
};

export function scanTerm(text: string, term: string): TermHit[] {
  const clean = term.trim();

  if (clean === "") {
    return [];
  }

  const pattern = termPattern(clean);
  const hits: TermHit[] = [];
  let match = pattern.exec(text);

  while (match !== null) {
    hits.push({ start: match.index, end: match.index + match[0].length, quote: match[0] });

    if (hits.length >= 50) {
      return hits;
    }

    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }

    match = pattern.exec(text);
  }

  return hits;
}

export function protectedTerms(input: ProtectedTermsInput): Promise<FindingCandidate[]> {
  const entries: TermEntry[] = [
    ...input.protectedTerms.map((term) => ({
      term,
      category: "protected-term" as const,
      title: `Protected term: ${term}`,
      reason: "You marked this term as sensitive for this package.",
    })),
    ...input.otherClientNames.map((term) => ({
      term,
      category: "other-client" as const,
      title: `Other client: ${term}`,
      reason: "This names a different client than the package recipient.",
    })),
  ];

  const candidates: FindingCandidate[] = [];
  const offsets = input.ocrWords === null ? [] : ocrWordOffsets(input.ocrWords);

  for (const entry of entries) {
    const relatedGroupId = slugTerm(entry.term);

    for (const hit of scanTerm(input.text, entry.term)) {
      const overlapping: OcrWord[] = offsets
        .filter((item) => item.start < hit.end && item.end > hit.start)
        .map((item) => item.word);

      if (overlapping.length > 0) {
        candidates.push({
          fileId: input.fileId,
          category: entry.category,
          detections: [
            {
              method: "protected-term",
              ruleId: null,
              evidence: [{ type: "image-region", box: unionBox(overlapping), quote: hit.quote }],
            },
          ],
          title: entry.title,
          reason: entry.reason,
          relatedGroupId,
        });
      } else {
        candidates.push({
          fileId: input.fileId,
          category: entry.category,
          detections: [
            {
              method: "protected-term",
              ruleId: null,
              evidence: [
                {
                  type: "text-span",
                  start: hit.start,
                  end: hit.end,
                  line: lineAt(input.text, hit.start),
                  quote: hit.quote,
                },
              ],
            },
          ],
          title: entry.title,
          reason: entry.reason,
          relatedGroupId,
        });
      }
    }
  }

  return Promise.resolve(candidates);
}
