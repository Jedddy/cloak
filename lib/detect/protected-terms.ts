import type { ProtectedTermsInput } from "@/lib/contract/interfaces";
import type { FindingCandidate } from "@/lib/contract/schemas";

import { candidateForHits, ocrWordOffsets } from "./evidence";
import type { Hit } from "./evidence";

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

export function scanTerm(text: string, term: string): Hit[] {
  const clean = term.trim();

  if (clean === "") {
    return [];
  }

  const pattern = termPattern(clean);
  const hits: Hit[] = [];
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
      const found = candidateForHits({
        fileId: input.fileId,
        text: input.text,
        offsets,
        method: "protected-term",
        ruleId: null,
        category: entry.category,
        title: entry.title,
        reason: entry.reason,
        relatedGroupId,
        hits: [hit],
      });

      if (found !== null) {
        candidates.push(found);
      }
    }
  }

  return Promise.resolve(candidates);
}
