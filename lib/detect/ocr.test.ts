import { describe, expect, test } from "bun:test";

import { assignLines, buildOcrResult, parseTsv } from "./ocr";

describe("assignLines", () => {
  test("groups overlapping rows into lines top to bottom", () => {
    const lines = assignLines([
      { x: 200, y: 50, w: 40, h: 16 },
      { x: 0, y: 8, w: 40, h: 16 },
      { x: 60, y: 10, w: 40, h: 16 },
      { x: 0, y: 52, w: 40, h: 16 },
    ]);

    expect(lines).toEqual([1, 0, 0, 1]);
  });
});

describe("parseTsv", () => {
  test("reads word rows with boxes and confidence", () => {
    const words = parseTsv(
      [
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
        "1\t1\t0\t0\t0\t0\t0\t0\t800\t600\t-1\t",
        "5\t1\t1\t1\t1\t1\t17\t17\t45\t17\t96.894669\tAcme",
        "5\t1\t1\t1\t1\t2\t76\t16\t47\t21\t93.270599\tCorp",
        "5\t1\t1\t1\t2\t1\t17\t60\t30\t12\t40.5\t",
      ].join("\n"),
    );

    expect(words).toEqual([
      { text: "Acme", confidence: 96.894_669, box: { x: 17, y: 17, w: 45, h: 17 } },
      { text: "Corp", confidence: 93.270_599, box: { x: 76, y: 16, w: 47, h: 21 } },
    ]);
  });

  test("skips malformed rows", () => {
    expect(parseTsv("level\ta\tb\n5\t1\t2\n")).toEqual([]);
  });
});

describe("buildOcrResult", () => {
  test("returns low confidence for empty pages", () => {
    expect(buildOcrResult([])).toEqual({ words: [], lowConfidence: true });
  });

  test("orders words by line then x and keeps boxes", () => {
    const result = buildOcrResult([
      { text: "Corp", confidence: 93, box: { x: 168, y: 8, w: 48, h: 18 } },
      { text: "Acme", confidence: 94, box: { x: 112, y: 8, w: 52, h: 18 } },
      { text: "mail", confidence: 90, box: { x: 0, y: 60, w: 30, h: 12 } },
    ]);

    expect(result.lowConfidence).toBe(false);
    expect(result.words.map((word) => word.text)).toEqual(["Acme", "Corp", "mail"]);
    expect(result.words.map((word) => word.line)).toEqual([0, 0, 1]);
  });

  test("flags low mean confidence and clamps the range", () => {
    const result = buildOcrResult([
      { text: "hard", confidence: 120, box: { x: 0, y: 0, w: 30, h: 10 } },
      { text: "toread", confidence: -5, box: { x: 35, y: 0, w: 40, h: 10 } },
    ]);

    expect(result.lowConfidence).toBe(true);
    expect(result.words.map((word) => word.confidence)).toEqual([100, 0]);
  });

  test("drops empty words", () => {
    const result = buildOcrResult([
      { text: "   ", confidence: 50, box: { x: 0, y: 0, w: 10, h: 10 } },
      { text: "hi", confidence: 95, box: { x: 20, y: 0, w: 20, h: 10 } },
    ]);

    expect(result.words).toHaveLength(1);
    expect(result.lowConfidence).toBe(false);
  });
});
