import { describe, expect, test } from "bun:test";
import * as mupdf from "mupdf";

import { PAGE_SCALE } from "@/lib/contract/schemas";

import { buildPdf } from "./fixtures/pdf";
import { extractPdf } from "./pdf";
import { redactPdf } from "./pdf-redact";
import { residue } from "./residue";

const extract = (bytes: Uint8Array) => extractPdf({ fileName: "a.pdf", format: "pdf", bytes });

type Plan = { spans?: string[]; regions?: { anchor: string; box: { x: number; y: number; w: number; h: number } }[]; hidden?: string[] };

/** Extracts, redacts the first occurrence of each span text, and removes the hidden items of the given kinds. */
async function run(bytes: Uint8Array, plan: Plan = {}) {
  const model = await extract(bytes);

  const spans = (plan.spans ?? []).map((text) => {
    const start = model.text.indexOf(text);

    expect(start).toBeGreaterThanOrEqual(0);

    return { start, end: start + text.length };
  });

  const removeHidden = model.hidden.filter((h) => (plan.hidden ?? []).includes(h.kind)).map((h) => h.id);

  const result = await redactPdf({
    fileName: "a.pdf",
    format: "pdf",
    bytes,
    model,
    spans,
    regions: plan.regions ?? [],
    removeHidden,
  });

  return { ...result, model, removeHidden };
}

function pdfText(bytes: Uint8Array): string[] {
  const doc = new mupdf.PDFDocument(bytes);

  const texts = Array.from({ length: doc.countPages() }, (_, i) => {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText();

    page.destroy();

    return text;
  });

  doc.destroy();

  return texts;
}

/** Gray level (0 = black) of the render pixel at (x, y) of a page. */
function pixel(bytes: Uint8Array, pageNumber: number, x: number, y: number): number {
  const doc = new mupdf.PDFDocument(bytes);
  const page = doc.loadPage(pageNumber - 1);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(PAGE_SCALE, PAGE_SCALE), mupdf.ColorSpace.DeviceGray, false, true);
  const value = pixmap.getPixels()[Math.floor(y) * pixmap.getStride() + Math.floor(x)]!;

  pixmap.destroy();
  page.destroy();
  doc.destroy();

  return value;
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

const three = buildPdf({
  pages: [{ lines: ["Page one text"] }, { lines: ["Contract with Acme Corp signed", "Second line"] }, { lines: ["Page three"] }],
});

describe("redactPdf text", () => {
  test("AE2: removes the text from every layer of the file and blacks out the box", async () => {
    const { bytes, model, notes } = await run(three, { spans: ["Acme Corp"] });
    const word = model.words.find((w) => w.text === "Acme")!;

    expect(pdfText(bytes).map((t) => t.includes("Acme"))).toEqual([false, false, false]);
    expect(pdfText(bytes)[1]).toContain("Second line");
    expect(pdfText(bytes)[0]).toContain("Page one text");
    expect(await residue({ format: "pdf", bytes, needles: ["Acme Corp", "Acme"] })).toEqual([]);
    expect(latin1(bytes)).not.toContain("Acme");
    expect(notes).toEqual([]);
    expect(pixel(bytes, 2, word.box.x + word.box.w / 2, word.box.y + word.box.h / 2)).toBe(0);

    const out = Bun.spawnSync(["pdftotext", "-", "-"], { stdin: bytes });

    if (out.exitCode === 0) {
      expect(out.stdout.toString()).not.toContain("Acme");
      expect(out.stdout.toString()).toContain("Page three");
    }
  });

  test("a span over Bookmarks text drops the outline", async () => {
    const doc = new mupdf.PDFDocument(three);

    doc.outlineIterator().insert({ title: "Chapter Zebra", uri: "#page=1", open: false });

    const withOutline = doc.saveToBuffer("").asUint8Array().slice();
    const { bytes } = await run(withOutline, { spans: ["Chapter Zebra"] });

    expect(latin1(bytes)).not.toContain("Zebra");
    expect(await residue({ format: "pdf", bytes, needles: ["Chapter Zebra"] })).toEqual([]);
  });

  test("AE3: a Type3 page is flattened to an image-only page with a note", async () => {
    const source = buildPdf({ pages: [{ lines: ["Page one"] }, { type3: true, lines: ["abab"], image: true }, { lines: ["Page three"] }] });
    const box = { x: 150 * PAGE_SCALE, y: 280 * PAGE_SCALE, w: 40 * PAGE_SCALE, h: 40 * PAGE_SCALE };
    const { bytes, notes } = await run(source, { spans: ["abab"], regions: [{ anchor: "page:2", box }] });
    const after = await extract(bytes);

    expect(notes).toEqual([{ kind: "flattened", note: "a.pdf page 2 flattened: text could not be removed natively." }]);
    expect(after.pages.map((p) => p.hasTextLayer)).toEqual([true, false, true]);
    expect(after.pages[1]).toMatchObject({ hasImages: true, width: 612 * PAGE_SCALE, height: 792 * PAGE_SCALE });
    expect(pdfText(bytes)[1].trim()).toBe("");
    expect(pdfText(bytes)[2]).toContain("Page three");
    expect(pixel(bytes, 2, 170 * PAGE_SCALE, 300 * PAGE_SCALE)).toBe(0);
    expect(pixel(bytes, 2, 100 * PAGE_SCALE, 250 * PAGE_SCALE)).toBeGreaterThan(100);
  });

  test("an off-page word is removed natively", async () => {
    const doc = new mupdf.PDFDocument(three);
    const page = doc.loadPage(0);

    page.getObject().get("Contents").writeStream("BT /F1 12 Tf 72 720 Td (Page one text) Tj ET BT /F1 12 Tf 2000 720 Td (Hidden Zebra) Tj ET");
    page.destroy();

    const source = doc.saveToBuffer("").asUint8Array().slice();
    const { bytes, model, notes } = await run(source, { hidden: ["off-page-text"] });

    expect(await residue({ format: "pdf", bytes: source, needles: ["Hidden Zebra"] })).toEqual(["Hidden Zebra"]);
    expect(notes).toEqual([]);

    expect(model.hidden.some((h) => h.kind === "off-page-text")).toBe(true);
    expect(latin1(bytes)).not.toContain("Zebra");
    expect(await residue({ format: "pdf", bytes, needles: ["Hidden Zebra"] })).toEqual([]);
    expect(pdfText(bytes)[0]).toContain("Page one text");
  });
});

describe("redactPdf regions", () => {
  test("a manual box over an image paints the pixels under it black", async () => {
    const source = buildPdf({ pages: [{ image: true }] });
    // The image covers x 72..312 pt, y 232..392 pt from the top.
    const box = { x: 150 * PAGE_SCALE, y: 280 * PAGE_SCALE, w: 40 * PAGE_SCALE, h: 40 * PAGE_SCALE };
    const before = pixel(source, 1, 170 * PAGE_SCALE, 300 * PAGE_SCALE);
    const { bytes } = await run(source, { regions: [{ anchor: "page:1", box }] });

    expect(before).toBeGreaterThan(100);
    expect(pixel(bytes, 1, 170 * PAGE_SCALE, 300 * PAGE_SCALE)).toBe(0);
    expect(pixel(bytes, 1, 100 * PAGE_SCALE, 250 * PAGE_SCALE)).toBeGreaterThan(100);
  });
});

describe("redactPdf hidden items", () => {
  test("removing a sticky note leaves no annotation and no author", async () => {
    const source = buildPdf({ pages: [{ lines: ["Body"], note: { author: "J. Cruz", contents: "Check the price" } }] });
    const { bytes, removeHidden } = await run(source, { hidden: ["annotation"] });
    const doc = new mupdf.PDFDocument(bytes);
    const page = doc.loadPage(0);

    expect(removeHidden).toHaveLength(1);
    expect(page.getAnnotations()).toHaveLength(0);
    expect(latin1(bytes)).not.toContain("Cruz");
    expect(await residue({ format: "pdf", bytes, needles: ["J. Cruz", "Check the price"] })).toEqual([]);
    page.destroy();
    doc.destroy();
  });

  test("removes an attachment, a link, and JavaScript", async () => {
    const built = buildPdf({
      pages: [{ lines: ["See"], link: "https://intranet.example.test/a" }],
      attachment: { name: "budget-notes.txt", text: "Zebra numbers" },
    });

    const doc = new mupdf.PDFDocument(built);
    const root = doc.getTrailer().get("Root");

    root.put("OpenAction", doc.addObject({ S: "JavaScript", JS: "app.alert('Zebra script')" }));
    root.get("Names").put("JavaScript", { Names: ["x", doc.addObject({ S: "JavaScript", JS: "app.alert('Zebra names')" })] });

    const source = doc.saveToBuffer("").asUint8Array().slice();
    const kinds = ["attachment", "external-link", "javascript"];

    expect(await residue({ format: "pdf", bytes: source, needles: ["budget-notes", "intranet", "Zebra"] })).toHaveLength(3);
    const { bytes, removeHidden } = await run(source, { hidden: kinds });
    const after = await extract(bytes);
    const text = latin1(bytes);

    expect(removeHidden).toHaveLength(3);
    expect(after.hidden).toEqual([]);
    expect(text).not.toContain("budget-notes");
    expect(text).not.toContain("intranet");
    expect(text).not.toContain("Zebra");
  });

  test("removes a form field with its value", async () => {
    const doc = new mupdf.PDFDocument(buildPdf({ pages: [{ lines: ["Form"] }] }));
    const page = doc.loadPage(0);
    const font = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" });

    const widget = doc.addObject({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Tx",
      T: "owner",
      V: "Zebra Person",
      DA: "/Helv 12 Tf 0 g",
      Rect: [100, 600, 300, 620],
      F: 4,
      P: page.getObject(),
    });

    page.getObject().put("Annots", [widget]);
    doc.getTrailer().get("Root").put("AcroForm", { Fields: [widget], DR: { Font: { Helv: font } }, DA: "/Helv 12 Tf 0 g" });
    page.destroy();

    const source = doc.saveToBuffer("").asUint8Array().slice();
    const { bytes, model } = await run(source, { hidden: ["form-field"] });

    expect(await residue({ format: "pdf", bytes: source, needles: ["Zebra Person"] })).toEqual(["Zebra Person"]);
    const reopened = new mupdf.PDFDocument(bytes);

    expect(model.hidden.some((h) => h.kind === "form-field")).toBe(true);
    expect(latin1(bytes)).not.toContain("Zebra");
    expect(reopened.getTrailer().get("Root", "AcroForm", "Fields").length).toBe(0);
    reopened.destroy();
  });

  test("a hidden layer's pages are flattened without the layer", async () => {
    const doc = new mupdf.PDFDocument(buildPdf({ pages: [{ lines: ["Visible text"] }, { lines: ["Other page"] }] }));
    const layer = doc.addObject({ Type: "OCG", Name: "Zebra layer" });
    const page = doc.loadPage(0);

    page.getObject().get("Resources").put("Properties", { MC0: layer });
    page.getObject().get("Contents").writeStream("BT /F1 12 Tf 72 720 Td (Visible text) Tj ET /OC /MC0 BDC BT /F1 12 Tf 72 600 Td (Layered secret) Tj ET EMC");
    doc.getTrailer().get("Root").put("OCProperties", { OCGs: [layer], D: { OFF: [layer], Order: [layer] } });
    page.destroy();

    const source = doc.saveToBuffer("").asUint8Array().slice();
    const { bytes, notes } = await run(source, { hidden: ["hidden-layer"] });

    expect(await residue({ format: "pdf", bytes: source, needles: ["Zebra layer"] })).toEqual(["Zebra layer"]);

    expect(notes).toEqual([{ kind: "flattened", note: "a.pdf page 1 flattened: a hidden layer was removed." }]);
    expect(latin1(bytes)).not.toContain("Zebra layer");
    expect(pdfText(bytes)[0].trim()).toBe("");
    expect(pdfText(bytes)[1]).toContain("Other page");
  });
});

describe("redactPdf output", () => {
  test("drops Info, XMP and page metadata, and saves a single revision", async () => {
    const xmp = "<?xpacket begin='x'?><x:xmpmeta xmlns:x='adobe:ns:meta/'><dc:creator>Pat Doe</dc:creator></x:xmpmeta>";
    const { bytes } = await run(buildPdf({ pages: [{ lines: ["Body"] }], info: { Author: "Pat Doe", Title: "Plan" }, xmp }));
    const doc = new mupdf.PDFDocument(bytes);

    expect(doc.getMetaData("info:Author")).toBeFalsy();
    expect(doc.getTrailer().get("Info").isNull()).toBe(true);
    expect(doc.getTrailer().get("Root", "Metadata").isNull()).toBe(true);
    expect(latin1(bytes)).not.toContain("Pat Doe");
    expect(latin1(bytes).match(/%%EOF/g)).toHaveLength(1);
    doc.destroy();
  });
});
