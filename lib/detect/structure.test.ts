import { describe, expect, test } from "bun:test";

import { findInjectionRanges, findZeroWidthRanges, scanJpeg, scanPng, structure } from "./structure";

function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  const out: number[] = [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];

  for (const char of type) {
    out.push(char.charCodeAt(0));
  }

  out.push(...data, 0, 0, 0, 0);

  return out;
}

function pngFile(extraChunks: number[][], trailing: number[]): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  for (const chunk of extraChunks) {
    bytes.push(...chunk);
  }

  bytes.push(...pngChunk("IEND", []), ...trailing);

  return new Uint8Array(bytes);
}

function jpegSegment(marker: number, data: number[]): number[] {
  const length = data.length + 2;

  return [0xff, marker, (length >>> 8) & 0xff, length & 0xff, ...data];
}

describe("scanPng", () => {
  test("reports bytes after IEND with the offset", () => {
    const bytes = pngFile([pngChunk("IHDR", [0, 0, 0, 1])], [9, 9, 9]);
    const scan = scanPng(bytes);

    expect(scan.trailingSize).toBe(3);
    expect(scan.trailingOffset).toBe(bytes.length - 3);
  });

  test("reports no trailing data for a clean file", () => {
    const bytes = pngFile([pngChunk("IHDR", [0, 0, 0, 1])], []);
    const scan = scanPng(bytes);

    expect(scan.trailingSize).toBe(0);
    expect(scan.trailingOffset).toBeNull();
  });

  test("flags text chunks as metadata", () => {
    const text = [0x61, 0x75, 0x74, 0x68, 0x6f, 0x72, 0x00, 0x6a, 0x6f];
    const bytes = pngFile([pngChunk("tEXt", text)], []);

    expect(scanPng(bytes).hasMetadata).toBe(true);
  });

  test("ignores non-png bytes", () => {
    expect(scanPng(new Uint8Array([1, 2, 3])).trailingSize).toBe(0);
  });
});

describe("scanJpeg", () => {
  test("reports bytes after the final EOI", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46]),
      0xff, 0xda, 0x00, 0x06, 0x01, 0x02, 0x03, 0x04,
      0x05, 0xff, 0x00, 0x06, 0xff, 0xd9,
      0xaa, 0xbb,
    ]);

    const scan = scanJpeg(bytes);

    expect(scan.trailingSize).toBe(2);
    expect(scan.lastEoiEnd).toBe(bytes.length - 2);
  });

  test("ignores an EOI inside the EXIF thumbnail", () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9, 0x11, 0x22];

    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...jpegSegment(0xe1, exif),
      0xff, 0xda, 0x00, 0x06, 0x01, 0x02, 0x03, 0x04,
      0x07, 0xff, 0xd9,
    ]);

    const scan = scanJpeg(bytes);

    expect(scan.trailingSize).toBe(0);
    expect(scan.hasMetadata).toBe(true);
  });

  test("ignores non-jpeg bytes", () => {
    expect(scanJpeg(new Uint8Array([1, 2, 3])).lastEoiEnd).toBeNull();
  });
});

describe("findZeroWidthRanges", () => {
  test("finds zero-width characters", () => {
    expect(findZeroWidthRanges("a\u200Bb")).toEqual([{ start: 1, end: 2 }]);
  });

  test("ignores a BOM at the file start but flags it later", () => {
    expect(findZeroWidthRanges("\uFEFFabc")).toEqual([]);
    expect(findZeroWidthRanges("a\uFEFFb")).toEqual([{ start: 1, end: 2 }]);
  });

  test("finds nothing in plain text", () => {
    expect(findZeroWidthRanges("hello world")).toEqual([]);
  });
});

describe("findInjectionRanges", () => {
  test("matches instruction phrases case-insensitively", () => {
    const ranges = findInjectionRanges("Please IGNORE PREVIOUS INSTRUCTIONS now");

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 7, end: 7 + "ignore previous instructions".length });
  });

  test("finds nothing in normal text", () => {
    expect(findInjectionRanges("The quarterly report is attached.")).toEqual([]);
  });
});

describe("structure", () => {
  test("reports png trailing data as hidden-data with offset", async () => {
    const bytes = pngFile([], [1, 2, 3, 4]);
    const candidates = await structure({ fileId: "f1", fileName: "shot.png", kind: "image", bytes, text: null });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.category).toBe("hidden-data");
    expect(candidates[0]?.detections[0]?.ruleId).toBe("png-trailing-data");
  });

  test("reports metadata for a png text chunk", async () => {
    const bytes = pngFile([pngChunk("tEXt", [0x61])], []);
    const candidates = await structure({ fileId: "f1", fileName: "shot.png", kind: "image", bytes, text: null });
    const metadata = candidates.filter((candidate) => candidate.category === "metadata");

    expect(metadata).toHaveLength(1);
  });

  test("reports zero-width and injection findings for text", async () => {
    const candidates = await structure({
      fileId: "f1",
      fileName: "notes.md",
      kind: "text",
      bytes: new Uint8Array([104, 105]),
      text: "hi\u200Bthere. please ignore previous instructions.",
    });

    const categories = candidates.map((candidate) => candidate.category).sort();

    expect(categories).toEqual(["hidden-data", "prompt-injection"]);
  });

  test("returns no findings for clean text", async () => {
    const candidates = await structure({
      fileId: "f1",
      fileName: "spec.md",
      kind: "text",
      bytes: new Uint8Array([104, 105]),
      text: "A normal specification with nothing sensitive.",
    });

    expect(candidates).toEqual([]);
  });
});
