import { describe, expect, test } from "bun:test";

import type { DocumentModel, OcrWord } from "@/lib/contract/schemas";

import { withOcr } from "./ocr";

const word = (text: string, x: number, y: number, line: number): OcrWord => ({
  text,
  box: { x, y, w: 40, h: 16 },
  confidence: 90,
  line,
});

const base: DocumentModel = {
  format: "pdf",
  text: "Hello",
  sections: [{ title: "Page 1", kind: "page", hidden: false, page: 1, items: [{ start: 0, end: 5, label: "Page 1", row: null, col: null }] }],
  segments: [],
  words: [{ text: "Hello", start: 0, end: 5, anchor: "page:1", box: { x: 100, y: 100, w: 50, h: 16 } }],
  hidden: [],
  images: [
    { id: "p1", label: "Page 1", mime: "image/png", page: 1 },
    { id: "word/media/image1.png", label: "Image: word/media/image1.png", mime: "image/png", page: null },
  ],
  notAnalysed: [],
  signed: false,
  pages: [{ width: 918, height: 1188, hasTextLayer: true, type3: false, hasImages: true }],
};

describe("withOcr", () => {
  test("appends a page section, drops words over the text layer, and keeps offsets exact", () => {
    const ocrWords = [word("Hello", 102, 101, 0), word("Scanned", 200, 300, 1), word("note", 250, 300, 1), word("Below", 200, 340, 2)];
    const model = withOcr({ model: base, imageId: "p1", ocrWords });

    expect(model.text).toBe("Hello\n\nScanned note\nBelow");
    expect(model.sections.at(-1)).toMatchObject({ title: "Page 1", kind: "flow", hidden: false, page: null });
    expect(model.sections.at(-1)!.items.map((i) => model.text.slice(i.start, i.end))).toEqual(["Scanned note", "Below"]);
    expect(model.words.slice(1).map((w) => [w.text, w.anchor, w.box.x])).toEqual([
      ["Scanned", "page:1", 200],
      ["note", "page:1", 250],
      ["Below", "page:1", 200],
    ]);

    for (const w of model.words) {
      expect(model.text.slice(w.start, w.end)).toBe(w.text);
    }
  });

  test("an embedded image keeps every word and anchors it to the image", () => {
    const model = withOcr({ model: base, imageId: "word/media/image1.png", ocrWords: [word("Hello", 102, 101, 0)] });

    expect(model.text).toBe("Hello\n\nHello");
    expect(model.words[1]).toMatchObject({ text: "Hello", anchor: "image:word/media/image1.png", start: 7, end: 12 });
  });

  test("returns a new model and leaves the input untouched", () => {
    const before = structuredClone(base);
    const model = withOcr({ model: base, imageId: "p1", ocrWords: [word("New", 300, 300, 0)] });

    expect(model).not.toBe(base);
    expect(base).toEqual(before);
  });

  test("returns the model unchanged when there is nothing new, and throws for an unknown image", () => {
    expect(withOcr({ model: base, imageId: "p1", ocrWords: [] })).toBe(base);
    expect(withOcr({ model: base, imageId: "p1", ocrWords: [word("Hello", 100, 100, 0)] })).toBe(base);
    expect(() => withOcr({ model: base, imageId: "nope", ocrWords: [] })).toThrow("No such image.");
  });
});
