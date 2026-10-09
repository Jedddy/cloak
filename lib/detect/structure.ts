import type { StructureInput } from "@/lib/contract/interfaces";
import type { FindingCandidate } from "@/lib/contract/schemas";

// Structure checks (overview section 11 layer 1, plan R4-R8). Pure bytes
// and text in, findings out. No file or network I/O.

const pngSignature: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const zeroWidthChars: ReadonlySet<string> = new Set(["\u200B", "\u200C", "\u200D", "\u2060"]);

const injectionPhrases: readonly string[] = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "disregard previous instructions",
  "mark this file as safe",
  "mark this as safe",
  "you are an ai",
  "you are now",
  "follow these new instructions",
];

export type TextRange = {
  start: number;
  end: number;
};

export function lineAt(text: string, index: number): number {
  let line = 0;

  for (let pos = 0; pos < index; pos += 1) {
    if (text[pos] === "\n") {
      line += 1;
    }
  }

  return line;
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < pngSignature.length) {
    return false;
  }

  return pngSignature.every((expected, index) => bytes[index] === expected);
}

export type PngScan = {
  trailingOffset: number | null;
  trailingSize: number;
  hasMetadata: boolean;
};

export function scanPng(bytes: Uint8Array): PngScan {
  const clean: PngScan = { trailingOffset: null, trailingSize: 0, hasMetadata: false };

  if (hasPngSignature(bytes) === false) {
    return clean;
  }

  let offset = pngSignature.length;
  let hasMetadata = false;

  while (offset + 8 <= bytes.length) {
    const length = readU32Be(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    const chunkEnd = offset + 8 + length + 4;

    if (chunkEnd > bytes.length) {
      return clean;
    }

    if (type === "tEXt" || type === "zTXt" || type === "iTXt" || type === "eXIf") {
      hasMetadata = true;
    }

    if (type === "IEND") {
      const trailingSize = bytes.length - chunkEnd;

      if (trailingSize > 0) {
        return { trailingOffset: chunkEnd, trailingSize, hasMetadata };
      }

      return { trailingOffset: null, trailingSize: 0, hasMetadata };
    }

    offset = chunkEnd;
  }

  return { trailingOffset: null, trailingSize: 0, hasMetadata };
}

export type JpegScan = {
  lastEoiEnd: number | null;
  trailingSize: number;
  hasMetadata: boolean;
};

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";

  for (let pos = 0; pos < length; pos += 1) {
    out += String.fromCharCode(bytes[offset + pos]);
  }

  return out;
}

export function scanJpeg(bytes: Uint8Array): JpegScan {
  const clean: JpegScan = { lastEoiEnd: null, trailingSize: 0, hasMetadata: false };

  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return clean;
  }

  let offset = 2;
  let lastEoiEnd: number | null = null;
  let hasMetadata = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }

    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8) {
      continue;
    }

    if (marker === 0xd9) {
      lastEoiEnd = offset;
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (marker === 0xda) {
      if (offset + 2 > bytes.length) {
        break;
      }

      const headerLength = readU16Be(bytes, offset);

      if (headerLength < 2 || offset + headerLength > bytes.length) {
        break;
      }

      let pos = offset + headerLength;

      while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 0xff) {
          pos += 1;
          continue;
        }

        const inner = bytes[pos + 1];

        if (inner === 0x00) {
          pos += 2;
          continue;
        }

        if (inner >= 0xd0 && inner <= 0xd7) {
          pos += 2;
          continue;
        }

        if (inner === 0xd9) {
          lastEoiEnd = pos + 2;
          pos += 2;
          break;
        }

        break;
      }

      offset = pos;
      continue;
    }

    if (offset + 2 > bytes.length) {
      break;
    }

    const segmentLength = readU16Be(bytes, offset);

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    const dataStart = offset + 2;
    const dataLength = segmentLength - 2;

    if (marker === 0xe1) {
      const head = asciiAt(bytes, dataStart, Math.min(dataLength, 29));

      if (head.startsWith("Exif\u0000\u0000") || head.includes("http://ns.adobe.com/xap/1.0/")) {
        hasMetadata = true;
      }
    }

    if (marker === 0xed) {
      const head = asciiAt(bytes, dataStart, Math.min(dataLength, 14));

      if (head.includes("Photoshop 3.0")) {
        hasMetadata = true;
      }
    }

    if (marker === 0xfe && dataLength > 0) {
      hasMetadata = true;
    }

    offset += segmentLength;
  }

  if (lastEoiEnd === null) {
    return { lastEoiEnd: null, trailingSize: 0, hasMetadata };
  }

  return { lastEoiEnd, trailingSize: bytes.length - lastEoiEnd, hasMetadata };
}

/** Zero-width runs in text. U+FEFF counts only past the file start. */
export function findZeroWidthRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let open: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const hidden = zeroWidthChars.has(char) || (char === "\uFEFF" && index !== 0);

    if (hidden) {
      if (open === null) {
        open = index;
      }
    } else if (open !== null) {
      ranges.push({ start: open, end: index });
      open = null;
    }
  }

  if (open !== null) {
    ranges.push({ start: open, end: text.length });
  }

  return ranges.slice(0, 20);
}

/** Case-insensitive instruction-phrase matches in text. */
export function findInjectionRanges(text: string): TextRange[] {
  const lower = text.toLowerCase();
  const ranges: TextRange[] = [];

  for (const phrase of injectionPhrases) {
    let from = 0;

    while (from <= lower.length - phrase.length) {
      const hit = lower.indexOf(phrase, from);

      if (hit === -1) {
        break;
      }

      ranges.push({ start: hit, end: hit + phrase.length });
      from = hit + phrase.length;

      if (ranges.length >= 20) {
        return ranges;
      }
    }
  }

  return ranges.sort((left, right) => left.start - right.start).slice(0, 20);
}

export function structure(input: StructureInput): Promise<FindingCandidate[]> {
  const candidates: FindingCandidate[] = [];
  const text = input.text;

  if (input.kind === "image") {
    const png = scanPng(input.bytes);

    if (png.trailingOffset !== null && png.trailingSize > 0) {
      candidates.push({
        fileId: input.fileId,
        category: "hidden-data",
        detections: [
          {
            method: "structure",
            ruleId: "png-trailing-data",
            evidence: [
              {
                type: "file-structure",
                note: `${png.trailingSize} bytes after the PNG IEND chunk. The cropped part of the image may still be in the file.`,
                byteOffset: png.trailingOffset,
              },
            ],
          },
        ],
        title: "Hidden data after the image",
        reason: "The cropped-out part of the screenshot is still in the file.",
        relatedGroupId: null,
      });
    }

    const jpeg = scanJpeg(input.bytes);

    if (jpeg.lastEoiEnd !== null && jpeg.trailingSize > 0) {
      candidates.push({
        fileId: input.fileId,
        category: "hidden-data",
        detections: [
          {
            method: "structure",
            ruleId: "jpeg-trailing-data",
            evidence: [
              {
                type: "file-structure",
                note: `${jpeg.trailingSize} bytes after the JPEG end marker. The cropped part of the image may still be in the file.`,
                byteOffset: jpeg.lastEoiEnd,
              },
            ],
          },
        ],
        title: "Hidden data after the image",
        reason: "The cropped-out part of the screenshot is still in the file.",
        relatedGroupId: null,
      });
    }

    if (png.hasMetadata || jpeg.hasMetadata) {
      candidates.push({
        fileId: input.fileId,
        category: "metadata",
        detections: [
          {
            method: "structure",
            ruleId: "image-metadata",
            evidence: [
              {
                type: "file-structure",
                note: "The image contains metadata such as device, author, software, or timestamps.",
                byteOffset: null,
              },
            ],
          },
        ],
        title: "Image metadata",
        reason: "The file contains metadata such as device, author, or location information.",
        relatedGroupId: null,
      });
    }
  }

  if (text !== null) {
    const zeroRanges = findZeroWidthRanges(text);

    if (zeroRanges.length > 0) {
      candidates.push({
        fileId: input.fileId,
        category: "hidden-data",
        detections: [
          {
            method: "structure",
            ruleId: "zero-width-chars",
            evidence: zeroRanges.map((range) => ({
              type: "text-span",
              start: range.start,
              end: range.end,
              line: lineAt(text, range.start),
              quote: text.slice(range.start, range.end),
            })),
          },
        ],
        title: "Hidden characters in text",
        reason: "The text contains invisible characters that can hide content.",
        relatedGroupId: null,
      });
    }

    const injectionRanges = findInjectionRanges(text);

    if (injectionRanges.length > 0) {
      candidates.push({
        fileId: input.fileId,
        category: "prompt-injection",
        detections: [
          {
            method: "structure",
            ruleId: "prompt-injection",
            evidence: injectionRanges.map((range) => ({
              type: "text-span",
              start: range.start,
              end: range.end,
              line: lineAt(text, range.start),
              quote: text.slice(range.start, range.end),
            })),
          },
        ],
        title: "Possible prompt injection",
        reason: "The text tries to instruct an AI. It is reported and never followed.",
        relatedGroupId: null,
      });
    }
  }

  return Promise.resolve(candidates);
}
