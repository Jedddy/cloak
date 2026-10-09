import type {
  Box,
  Category,
  Detection,
  DetectionMethod,
  Evidence,
  FindingCandidate,
  OcrWord,
} from "@/lib/contract/schemas";

import { lineAt } from "./structure";

// Shared evidence mapping for the text-based layers. Character offsets in
// OCR-derived text map back to word boxes; plain text becomes text spans.

export type WordOffset = {
  word: OcrWord;
  start: number;
  end: number;
};

export type Hit = {
  start: number;
  end: number;
  quote: string;
};

/** Offsets of each OCR word in text built like the pipeline builds it. */
export function ocrWordOffsets(words: OcrWord[]): WordOffset[] {
  const byLine = new Map<number, OcrWord[]>();

  for (const word of words) {
    byLine.set(word.line, [...(byLine.get(word.line) ?? []), word]);
  }

  const ordered = [...byLine.entries()].sort(([left], [right]) => left - right);
  const offsets: WordOffset[] = [];
  let cursor = 0;

  for (const [, line] of ordered) {
    for (const word of line) {
      offsets.push({ word, start: cursor, end: cursor + word.text.length });
      cursor += word.text.length + 1;
    }
  }

  return offsets;
}

export function unionBox(words: OcrWord[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const word of words) {
    minX = Math.min(minX, word.box.x);
    minY = Math.min(minY, word.box.y);
    maxX = Math.max(maxX, word.box.x + word.box.w);
    maxY = Math.max(maxY, word.box.y + word.box.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function overlappingWords(offsets: WordOffset[], start: number, end: number): OcrWord[] {
  return offsets.flatMap((entry) => (entry.start < end && entry.end > start ? [entry.word] : []));
}

/** One hit becomes an image region over OCR words, or a text span. */
export function evidenceForHit(text: string, offsets: WordOffset[], hit: Hit): Evidence {
  const overlapping = overlappingWords(offsets, hit.start, hit.end);

  if (overlapping.length > 0) {
    return { type: "image-region", box: unionBox(overlapping), quote: hit.quote };
  }

  return {
    type: "text-span",
    start: hit.start,
    end: hit.end,
    line: lineAt(text, hit.start),
    quote: hit.quote,
  };
}

/** True when any text or image-region evidence quotes the text exactly. */
export function hasQuote(detections: Detection[], text: string): boolean {
  const wanted = text.toLowerCase();

  return detections.some((detection) =>
    detection.evidence.some(
      (evidence) =>
        (evidence.type === "text-span" || evidence.type === "image-region") &&
        evidence.quote !== null &&
        evidence.quote.toLowerCase() === wanted,
    ),
  );
}

export type HitCandidateInput = {
  fileId: string;
  text: string;
  offsets: WordOffset[];
  method: DetectionMethod;
  ruleId: string | null;
  category: Category;
  title: string;
  reason: string;
  relatedGroupId: string | null;
  hits: Hit[];
};

/** One candidate covering every hit, or null when there are no hits. */
export function candidateForHits(input: HitCandidateInput): FindingCandidate | null {
  if (input.hits.length === 0) {
    return null;
  }

  return {
    fileId: input.fileId,
    category: input.category,
    detections: [
      {
        method: input.method,
        ruleId: input.ruleId,
        evidence: input.hits.map((hit) => evidenceForHit(input.text, input.offsets, hit)),
      },
    ],
    title: input.title,
    reason: input.reason,
    relatedGroupId: input.relatedGroupId,
  };
}
