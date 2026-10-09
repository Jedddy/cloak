import type { Box, DocumentModel, DocumentWord, OcrWord } from "@/lib/contract/schemas";

// Merges OCR output into a document model (plan Assumptions). Format-agnostic:
// OCR boxes are already in the pixels of the image the OCR ran on (the PAGE_SCALE
// render for a PDF page), which is what word boxes use.

/** Share of the OCR box that must lie on one text-layer word to count as the same text. */
const OVERLAP_SHARE = 0.3;

function overlapShare(ocr: Box, other: Box): number {
  const width = Math.min(ocr.x + ocr.w, other.x + other.w) - Math.max(ocr.x, other.x);
  const height = Math.min(ocr.y + ocr.h, other.y + other.h) - Math.max(ocr.y, other.y);

  return width > 0 && height > 0 ? (width * height) / (ocr.w * ocr.h) : 0;
}

/** Appends one image's OCR text as a new section and words; returns a new model, or the same one when nothing is added. */
export function withOcr(input: { model: DocumentModel; imageId: string; ocrWords: OcrWord[] }): DocumentModel {
  const { model, imageId } = input;
  const image = model.images.find((entry) => entry.id === imageId);

  if (!image) {
    throw new Error("No such image.");
  }

  const anchor = image.page ? `page:${image.page}` : `image:${imageId}`;
  const layerWords = model.words.filter((word) => word.anchor === anchor);
  const kept = input.ocrWords.filter((ocr) => !layerWords.some((word) => overlapShare(ocr.box, word.box) > OVERLAP_SHARE));

  if (kept.length === 0) {
    return model;
  }

  const lines = new Map<number, OcrWord[]>();

  for (const ocr of kept) {
    lines.set(ocr.line, [...(lines.get(ocr.line) ?? []), ocr]);
  }

  let text = model.text ? `${model.text}\n\n` : "";
  const words: DocumentWord[] = [];
  const items: DocumentModel["sections"][number]["items"] = [];

  for (const [lineIndex, line] of [...lines.entries()].sort(([a], [b]) => a - b).entries()) {
    if (lineIndex > 0) {
      text += "\n";
    }

    const start = text.length;

    for (const [wordIndex, ocr] of line[1].entries()) {
      if (wordIndex > 0) {
        text += " ";
      }

      words.push({ text: ocr.text, start: text.length, end: text.length + ocr.text.length, anchor, box: ocr.box });
      text += ocr.text;
    }

    items.push({ start, end: text.length, label: image.label, row: null, col: null });
  }

  return {
    ...model,
    text,
    sections: [...model.sections, { title: image.label, kind: "flow", hidden: false, page: null, items }],
    words: [...model.words, ...words],
  };
}
