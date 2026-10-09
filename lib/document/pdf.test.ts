import { describe, expect, test } from "bun:test";
import * as mupdf from "mupdf";
import sharp from "sharp";

import { PAGE_SCALE } from "@/lib/contract/schemas";

import { buildEncryptedPdf, buildPdf } from "./fixtures/pdf";
import { extractPdf, pdfImages, renderPdfPage } from "./pdf";

const extract = (bytes: Uint8Array) => extractPdf({ fileName: "a.pdf", format: "pdf", bytes });

const threePages = buildPdf({
  pages: [{ lines: ["Alpha one", "Alpha two"] }, { lines: ["Beta"] }, { lines: ["Gamma three"] }],
});

describe("extractPdf text", () => {
  test("keeps each page's words in page order with boxes inside the page", async () => {
    const model = await extract(threePages);

    expect(model.format).toBe("pdf");
    expect(model.text).toBe("Alpha one\nAlpha two\n\nBeta\n\nGamma three");
    expect(model.sections.map((s) => [s.title, s.kind, s.page])).toEqual([
      ["Page 1", "page", 1],
      ["Page 2", "page", 2],
      ["Page 3", "page", 3],
    ]);
    expect(model.words.map((w) => w.text)).toEqual(["Alpha", "one", "Alpha", "two", "Beta", "Gamma", "three"]);

    for (const word of model.words) {
      const page = model.pages[Number(word.anchor.slice("page:".length)) - 1]!;

      expect(model.text.slice(word.start, word.end)).toBe(word.text);
      expect(word.box.x + word.box.w).toBeLessThanOrEqual(page.width);
      expect(word.box.y + word.box.h).toBeLessThanOrEqual(page.height);
    }

    expect(model.words[4]!.anchor).toBe("page:2");
    expect(model.pages[0]).toEqual({
      width: 612 * PAGE_SCALE,
      height: 792 * PAGE_SCALE,
      hasTextLayer: true,
      type3: false,
      hasImages: false,
    });
    expect(model.images).toEqual([]);
  });

  test("an image-only page has no text layer, no words, and is listed for OCR", async () => {
    const model = await extract(buildPdf({ pages: [{ lines: ["Text page"] }, { image: true }] }));

    expect(model.pages[1]).toMatchObject({ hasTextLayer: false, hasImages: true });
    expect(model.words.every((w) => w.anchor === "page:1")).toBe(true);
    expect(model.images).toEqual([{ id: "p2", label: "Page 2", mime: "image/png", page: 2 }]);
  });

  test("an image on a text page is listed for OCR too", async () => {
    const model = await extract(buildPdf({ pages: [{ lines: ["Hello"], image: true }] }));

    expect(model.pages[0]).toMatchObject({ hasTextLayer: true, hasImages: true });
    expect(model.images.map((i) => i.id)).toEqual(["p1"]);
  });

  test("flags a Type3 font page and still extracts its text", async () => {
    const model = await extract(buildPdf({ pages: [{ lines: ["Plain"] }, { type3: true, lines: ["ab"] }] }));

    expect(model.pages.map((p) => p.type3)).toEqual([false, true]);
    expect(model.words.find((w) => w.anchor === "page:2")?.text).toBe("ab");
  });

  test("adds bookmark titles as a Bookmarks section without words", async () => {
    const doc = new mupdf.PDFDocument(threePages);
    const outline = doc.outlineIterator();

    outline.insert({ title: "Chapter Zebra", uri: "#page=1", open: false });
    const bytes = doc.saveToBuffer("").asUint8Array().slice();
    const model = await extract(bytes);
    const section = model.sections.at(-1)!;

    expect(section).toMatchObject({ title: "Bookmarks", kind: "flow", page: null });
    expect(model.text.slice(section.items[0]!.start, section.items[0]!.end)).toBe("Chapter Zebra");
    expect(model.words.some((w) => w.text === "Chapter")).toBe(false);
  });

  test("rejects unreadable and encrypted files", async () => {
    await expect(extract(new Uint8Array([1, 2, 3]))).rejects.toThrow("The document cannot be read.");
    await expect(extract(buildEncryptedPdf())).rejects.toThrow("Encrypted PDF");
  });
});

describe("extractPdf hidden items", () => {
  test("a sticky note names its author", async () => {
    const model = await extract(
      buildPdf({ pages: [{ lines: ["Body"], note: { author: "J. Cruz", contents: "Check the price" } }] }),
    );

    const item = model.hidden.filter((h) => h.kind === "annotation");

    expect(item).toHaveLength(1);
    expect(item[0]).toMatchObject({
      note: "Comment by J. Cruz on page 1: 'Check the price'",
      quote: "J. Cruz",
      category: "hidden-data",
    });
  });

  test("Info author plus XMP make one metadata item", async () => {
    const xmp = "<?xpacket begin='x'?><x:xmpmeta xmlns:x='adobe:ns:meta/'><dc:creator>Pat Doe</dc:creator></x:xmpmeta>";
    const model = await extract(buildPdf({ pages: [{ lines: ["Body"] }], info: { Author: "Pat Doe" }, xmp }));
    const items = model.hidden.filter((h) => h.kind === "metadata");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quote: "Pat Doe", category: "metadata" });
  });

  test("an attachment names the file", async () => {
    const model = await extract(
      buildPdf({ pages: [{ lines: ["Body"] }], attachment: { name: "budget-notes.txt", text: "secret" } }),
    );

    expect(model.hidden.find((h) => h.kind === "attachment")).toMatchObject({
      note: "Attached file 'budget-notes.txt'",
      quote: "budget-notes.txt",
      category: "hidden-data",
    });
  });

  test("a URI link reports its host, and a plain PDF has no hidden items", async () => {
    const linked = await extract(buildPdf({ pages: [{ lines: ["See"], link: "https://intranet.example.test/a?b=1" }] }));
    const plain = await extract(threePages);

    expect(linked.hidden.find((h) => h.kind === "external-link")).toMatchObject({
      note: "Link to intranet.example.test",
      quote: "intranet.example.test",
    });
    expect(plain.hidden).toEqual([]);
    expect(plain.signed).toBe(false);
  });

  test("text outside the page stays in the text and is reported", async () => {
    const doc = new mupdf.PDFDocument(threePages);
    const page = doc.loadPage(0);
    const font = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" });

    page.getObject().put("Resources", { Font: { F1: font } });
    page.getObject().put("Contents", doc.addStream("BT /F1 12 Tf 900 400 Td (Offside note) Tj ET BT /F1 0.5 Tf 72 300 Td (Tiny) Tj ET", {}));
    const model = await extract(doc.saveToBuffer("").asUint8Array().slice());

    expect(model.text).toContain("Offside note");
    expect(model.text).toContain("Tiny");
    expect(model.hidden.find((h) => h.kind === "off-page-text")).toMatchObject({
      note: "Text outside the visible page on page 1",
      quote: "Offside note Tiny",
    });
  });

  test("reports JavaScript, a hidden layer, a form value, and a signature", async () => {
    const doc = new mupdf.PDFDocument(threePages);
    const root = doc.getTrailer().get("Root");
    const layer = doc.addObject({ Type: "OCG", Name: "(Draft notes)" });
    const page = doc.loadPage(0);
    const field = page.createAnnotation("Widget");
    const sign = page.createAnnotation("Widget");

    root.put("OpenAction", { S: "JavaScript", JS: "(app.alert(1))" });
    root.put("OCProperties", { OCGs: [layer], D: { OFF: [layer] } });
    field.getObject().put("FT", "Tx");
    field.getObject().put("T", "(Client)");
    field.getObject().put("V", "(Acme Ltd)");
    sign.getObject().put("FT", "Sig");
    sign.getObject().put("V", { Type: "Sig", Filter: "Adobe.PPKLite" });
    const model = await extract(doc.saveToBuffer("").asUint8Array().slice());
    const byKind = Object.fromEntries(model.hidden.map((h) => [h.kind, h]));

    expect(byKind.javascript).toBeDefined();
    expect(byKind["hidden-layer"]).toMatchObject({ note: "Hidden layer 'Draft notes'", quote: "Draft notes" });
    expect(byKind["form-field"]).toMatchObject({ note: "Form field 'Client' value 'Acme Ltd'", quote: "Acme Ltd" });
    expect(model.signed).toBe(true);
  });

  test("ids are stable when the document is saved again with garbage collection", async () => {
    const original = buildPdf({
      pages: [{ lines: ["Body"], note: { author: "J. Cruz", contents: "Check" }, link: "https://a.example.test/" }],
      info: { Author: "Pat Doe" },
      attachment: { name: "n.txt", text: "x" },
    });

    const doc = new mupdf.PDFDocument(original);
    const resaved = doc.saveToBuffer("garbage=4,compress,clean").asUint8Array().slice();
    const before = (await extract(original)).hidden;
    const after = (await extract(resaved)).hidden;

    expect(before.map((h) => h.kind).sort()).toEqual(["annotation", "attachment", "external-link", "metadata"]);
    expect(after.map((h) => h.id).sort()).toEqual(before.map((h) => h.id).sort());
  });
});

describe("rendering", () => {
  test("renderPdfPage returns a PNG at PAGE_SCALE", async () => {
    const png = await renderPdfPage({ bytes: threePages, page: 2 });
    const meta = await sharp(png).metadata();

    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([612 * PAGE_SCALE, 792 * PAGE_SCALE]);
  });

  test("renderPdfPage throws for a page out of range", async () => {
    await expect(renderPdfPage({ bytes: threePages, page: 4 })).rejects.toThrow("No such page.");
    await expect(renderPdfPage({ bytes: threePages, page: 0 })).rejects.toThrow("No such page.");
  });

  test("pdfImages renders one PNG per model image", async () => {
    const bytes = buildPdf({ pages: [{ lines: ["Text"] }, { image: true }] });
    const input = { fileName: "a.pdf", format: "pdf" as const, bytes };
    const images = await pdfImages({ ...input, model: await extractPdf(input) });

    expect(images.map((i) => [i.id, i.mime])).toEqual([["p2", "image/png"]]);
    expect((await sharp(images[0]!.bytes).metadata()).width).toBe(612 * PAGE_SCALE);
  });

  test("20 extract and render runs on one document complete without errors", async () => {
    for (let run = 0; run < 20; run += 1) {
      const model = await extract(threePages);

      expect(model.words).toHaveLength(7);
      expect((await renderPdfPage({ bytes: threePages, page: 1 })).byteLength).toBeGreaterThan(100);
    }
  });
});
