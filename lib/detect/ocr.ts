import { z } from "zod";

import type { OcrInput } from "@/lib/contract/interfaces";
import type { Box, OcrResult, OcrWord } from "@/lib/contract/schemas";
import type { createWorker } from "tesseract.js";

// OCR layer (overview section 11 layer 4, plan R13-R14, spike F3).
// tesseract.js runs in the Node runtime with language data from a local
// directory, so it works with the network off once the data is present.
// Word boxes come from the TSV output (stable across versions): one row
// per word with its box, confidence, and text. Results are cacheable by
// the server (the pipeline keeps derived OCR files); this module stays
// free of file I/O besides the language data.

export const OCR_LOW_CONFIDENCE_MEAN = 65;

/** A recognized word before line assignment. */
export type RawWord = {
  text: string;
  confidence: number;
  box: Box;
};

const TesseractOutputSchema = z.object({ tsv: z.string() });

/** Reads word rows (level 5) from tesseract TSV output. */
export function parseTsv(tsv: string): RawWord[] {
  const words: RawWord[] = [];
  const rows = tsv.split("\n");

  for (const row of rows.slice(1)) {
    const columns = row.split("\t");

    if (columns.length < 12 || columns[0] !== "5") {
      continue;
    }

    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join("\t");

    if (
      Number.isFinite(left) === false ||
      Number.isFinite(top) === false ||
      Number.isFinite(width) === false ||
      Number.isFinite(height) === false ||
      Number.isFinite(confidence) === false ||
      width <= 0 ||
      height <= 0 ||
      text.trim() === ""
    ) {
      continue;
    }

    words.push({ text, confidence, box: { x: left, y: top, w: width, h: height } });
  }

  return words;
}

/** Groups boxes into lines by vertical overlap, top to bottom. */
export function assignLines(boxes: Box[]): number[] {
  const order = boxes
    .map((box, index) => index)
    .sort((left, right) => boxes[left].y + boxes[left].h / 2 - (boxes[right].y + boxes[right].h / 2));

  const lineOf: number[] = boxes.map(() => -1);
  let lineCount = 0;
  let lineCenter = 0;
  let lineHeight = 0;

  for (const index of order) {
    const box = boxes[index];
    const center = box.y + box.h / 2;

    if (lineCount === 0 || Math.abs(center - lineCenter) > Math.max(box.h, lineHeight) / 2) {
      lineCount += 1;
      lineCenter = center;
      lineHeight = box.h;
    } else {
      lineCenter = (lineCenter + center) / 2;
      lineHeight = Math.max(lineHeight, box.h);
    }

    lineOf[index] = lineCount - 1;
  }

  return lineOf;
}

/** Drops empty words, orders by line then x, and assigns line numbers. */
export function buildOcrResult(raw: RawWord[]): OcrResult {
  const kept = raw.filter((word) => word.text.trim() !== "");
  const lines = assignLines(kept.map((word) => word.box));

  const words: OcrWord[] = kept
    .map((word, index) => ({ word, line: lines[index] ?? 0 }))
    .sort((left, right) => left.line - right.line || left.word.box.x - right.word.box.x)
    .map(({ word, line }) => ({
      text: word.text,
      box: word.box,
      confidence: Math.min(100, Math.max(0, word.confidence)),
      line,
    }));

  if (words.length === 0) {
    return { words: [], lowConfidence: true };
  }

  const mean = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;

  return { words, lowConfidence: mean < OCR_LOW_CONFIDENCE_MEAN };
}

type Worker = Awaited<ReturnType<typeof createWorker>>;

let cachedWorker: Promise<Worker> | null = null;

function modelDir(): string {
  const configured = process.env.SENTINEL_TESSERACT_MODEL_DIR;

  if (configured !== undefined && configured !== "") {
    return configured;
  }

  return "workspace/models/tesseract";
}

async function loadWorker(): Promise<Worker> {
  if (cachedWorker === null) {
    const start = async (): Promise<Worker> => {
      const { createWorker: create } = await import("tesseract.js");

      // LSTM engine with local language data; gzip off because the local
      // traineddata files are stored uncompressed. cachePath keeps
      // tesseract's own cache inside the workspace instead of the cwd.
      const dir = modelDir();

      return create("eng", 1, { langPath: dir, cachePath: dir, gzip: false });
    };

    cachedWorker = start().catch((error: Error) => {
      cachedWorker = null;
      throw error;
    });
  }

  return cachedWorker;
}

export async function ocr(input: OcrInput): Promise<OcrResult> {
  const worker = await loadWorker();
  const image = Buffer.from(input.bytes);
  const { data } = await worker.recognize(image, {}, { tsv: true });
  const parsed = TesseractOutputSchema.parse(data);

  return buildOcrResult(parseTsv(parsed.tsv));
}
