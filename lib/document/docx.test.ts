import { describe, expect, test } from "bun:test";

import type { DocumentModel } from "@/lib/contract/schemas";

import { buildDocx, type DocxOptions } from "./fixtures/ooxml";
import { extractOoxml, loadPackage } from "./ooxml";

async function extract(options: DocxOptions): Promise<DocumentModel> {
  return extractOoxml({ fileName: "a.docx", format: "docx", bytes: await buildDocx(options) });
}

function sectionOf(model: DocumentModel, needle: string): string | undefined {
  return model.sections.find((section) => section.items.some((item) => model.text.slice(item.start, item.end).includes(needle)))
    ?.title;
}

describe("docx extraction", () => {
  test("body, table and header text are in model.text with their sections", async () => {
    const model = await extract({ paragraphs: ["Quarterly plan"], table: [["Cell A1", "Cell B1"]], header: "Header words" });

    expect(model.text).toContain("Quarterly plan");
    expect(model.text).toContain("Cell B1");
    expect(model.text).toContain("Header words");
    expect(sectionOf(model, "Quarterly plan")).toBe("Body");
    expect(sectionOf(model, "Cell B1")).toBe("Table 1");
    expect(sectionOf(model, "Header words")).toBe("Header 1");
    expect(model.sections.find((section) => section.title === "Table 1")?.kind).toBe("grid");

    const cell = model.sections.find((section) => section.title === "Table 1")?.items[1];

    expect(cell).toMatchObject({ label: "Table 1 R1C2", row: 0, col: 1 });
  });

  test("a run split over three w:r is contiguous with one segment each", async () => {
    const model = await extract({ splitRuns: ["Ac", "me Co", "rp"] });
    const start = model.text.indexOf("Acme Corp");

    expect(start).toBeGreaterThanOrEqual(0);

    const segments = model.segments.filter((segment) => segment.start >= start && segment.end <= start + 9);

    expect(segments.map((segment) => model.text.slice(segment.start, segment.end))).toEqual(["Ac", "me Co", "rp"]);
    expect(segments.map((segment) => segment.node)).toEqual([0, 1, 2]);
    expect(segments[0].part).toBe("word/document.xml");
  });

  test("AE4: two insertions and a comment become three hidden items naming the author", async () => {
    const model = await extract({
      paragraphs: ["Body"],
      insertions: [
        { id: 11, author: "J. Cruz", text: "Added one" },
        { id: 12, author: "J. Cruz", text: "Added two" },
      ],
      comments: [{ id: 3, author: "J. Cruz", text: "Check the price" }],
    });

    const revisions = model.hidden.filter((item) => item.kind === "revision");
    const comments = model.hidden.filter((item) => item.kind === "comment");

    expect(revisions.map((item) => item.id)).toEqual(["ins-11", "ins-12"]);
    expect(revisions[0]).toMatchObject({ note: "Tracked insertion by J. Cruz", quote: "J. Cruz", category: "hidden-data" });
    expect(comments).toEqual([
      { id: "comment-3", kind: "comment", note: "Comment by J. Cruz: 'Check the price'", quote: "J. Cruz", category: "hidden-data" },
    ]);
    expect(model.text).toContain("Added one");
    expect(sectionOf(model, "Check the price")).toBe("Comments");
  });

  test("tracked deletions keep their text and name the author", async () => {
    const model = await extract({ deletions: [{ id: 7, author: "A. Lee", text: "Removed price" }] });

    expect(model.text).toContain("Removed price");
    expect(model.hidden).toContainEqual(expect.objectContaining({ id: "del-7", note: "Tracked deletion by A. Lee" }));
  });

  test("hidden ids stay the same when a sibling is removed", async () => {
    const both = await extract({
      insertions: [
        { id: 11, author: "J. Cruz", text: "One" },
        { id: 12, author: "J. Cruz", text: "Two" },
      ],
    });

    const second = await extract({ insertions: [{ id: 12, author: "J. Cruz", text: "Two" }] });

    expect(second.hidden.map((item) => item.id)).toEqual(["ins-12"]);
    expect(both.hidden.map((item) => item.id)).toContain("ins-12");
  });

  test("vanished, white runs, and external hyperlinks are hidden items and stay in the text", async () => {
    const model = await extract({
      vanishRun: "secret vanish",
      whiteRun: "secret white",
      hyperlink: "https://intranet.clientx.example/wiki",
    });

    expect(model.text).toContain("secret vanish");
    expect(model.text).toContain("secret white");

    const kinds = model.hidden.map((item) => item.kind);

    expect(kinds.filter((kind) => kind === "hidden-text")).toHaveLength(2);
    expect(model.hidden).toContainEqual(
      expect.objectContaining({ kind: "external-link", note: "Link to intranet.clientx.example", quote: "intranet.clientx.example" }),
    );
    expect(model.hidden.find((item) => item.id.startsWith("vanish-"))?.quote).toBe("secret vanish");
  });

  test("author properties are a metadata item", async () => {
    const model = await extract({ author: "J. Cruz", lastModifiedBy: "A. Lee" });

    expect(model.hidden).toEqual([
      {
        id: "metadata",
        kind: "metadata",
        note: "Document properties: author 'J. Cruz', last modified by 'A. Lee'",
        quote: "J. Cruz",
        category: "metadata",
      },
    ]);
  });

  test("AE7: SmartArt, a GIF, and a PNG are inventoried", async () => {
    const model = await extract({ paragraphs: ["x"], smartArt: true, image: true });

    expect(model.notAnalysed).toContainEqual({ label: "SmartArt word/diagrams/data1.xml", reason: "SmartArt text is not read" });
    expect(model.notAnalysed).toContainEqual({ label: "Image: word/media/image2.gif", reason: "Image format not analysed" });
    expect(model.images).toEqual([
      { id: "word/media/image1.png", label: "Image: word/media/image1.png", mime: "image/png", page: null },
    ]);
  });

  test("tracked formatting changes and moves are revision items naming the author", async () => {
    const model = await extract({
      formatChanges: [{ id: 21, author: "J. Cruz", text: "Bold words" }],
      moves: [{ id: 3, author: "J. Cruz", from: "Moved secret text", to: "Relocated paragraph" }],
    });

    const revisions = model.hidden.filter((item) => item.kind === "revision");

    expect(revisions.map((item) => item.id)).toEqual([
      "rPrChange-21",
      "moveFromRangeStart-30",
      "moveFrom-32",
      "moveToRangeStart-31",
      "moveTo-33",
    ]);
    expect(revisions.every((item) => item.quote === "J. Cruz" && item.category === "hidden-data" && item.note.includes("J. Cruz"))).toBe(true);
    expect(model.text).toContain("Moved secret text");
  });

  test("table, section, paragraph property changes and cell markers are revision items", async () => {
    const bytes = await buildDocx({ paragraphs: ["x"] });
    const pkg = await loadPackage(bytes);
    const attrs = 'w:id="%ID%" w:author="A. Lee" w:date="2026-01-02T03:04:05Z"';
    const at = (id: number) => attrs.replace("%ID%", String(id));

    const xml = await pkg.zip.file("word/document.xml")!.async("string");

    pkg.zip.file(
      "word/document.xml",
      xml.replace(
        "</w:body>",
        `<w:p><w:pPr><w:pPrChange ${at(1)}><w:pPr/></w:pPrChange></w:pPr></w:p>` +
          `<w:tbl><w:tblPr><w:tblPrChange ${at(2)}><w:tblPr/></w:tblPrChange></w:tblPr><w:tblGrid/>` +
          `<w:tr><w:trPr><w:trPrChange ${at(3)}><w:trPr/></w:trPrChange></w:trPr>` +
          `<w:tc><w:tcPr><w:cellIns ${at(4)}/><w:cellDel ${at(5)}/><w:tcPrChange ${at(6)}><w:tcPr/></w:tcPrChange></w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body>`,
      ).replace("<w:sectPr>", `<w:sectPr><w:sectPrChange ${at(7)}><w:sectPr/></w:sectPrChange>`),
    );

    const model = await extractOoxml({ fileName: "a.docx", format: "docx", bytes: await pkg.zip.generateAsync({ type: "uint8array" }) });

    expect(model.hidden.filter((item) => item.kind === "revision").map((item) => item.id).sort()).toEqual([
      "cellDel-5",
      "cellIns-4",
      "pPrChange-1",
      "sectPrChange-7",
      "tblPrChange-2",
      "tcPrChange-6",
      "trPrChange-3",
    ]);
  });

  test("field instructions are analysed text in their own section and the display result stays in the body", async () => {
    const model = await extract({
      paragraphs: ["Before"],
      fields: [{ instr: ' HYPERLINK "https://intranet.clientx.example/wiki" ', result: "Click here", split: true }, { instr: " PAGE ", result: "1" }],
      simpleFields: [{ instr: 'INCLUDETEXT "\\\\fileserver\\clientx\\a.docx"', result: "Included" }],
    });

    const section = model.sections.find((entry) => entry.title === "Field codes: Body");
    const texts = section?.items.map((item) => model.text.slice(item.start, item.end));

    expect(texts).toEqual([' HYPERLINK "https://intranet.clientx.example/wiki" ', " PAGE ", 'INCLUDETEXT "\\\\fileserver\\clientx\\a.docx"']);
    expect(sectionOf(model, "Click here")).toBe("Body");
    expect(model.text).not.toContain("Click here HYPERLINK");

    const links = model.hidden.filter((item) => item.id.startsWith("field-"));

    expect(links.map((item) => [item.kind, item.note, item.quote])).toEqual([
      ["external-link", "Field link to intranet.clientx.example", "intranet.clientx.example"],
      ["external-link", "Field link to \\\\fileserver\\clientx\\a.docx", "\\\\fileserver\\clientx\\a.docx"],
    ]);
  });

  test("internal HYPERLINK bookmarks are not links", async () => {
    const model = await extract({ fields: [{ instr: ' HYPERLINK \\l "_Toc123" ', result: "Section" }] });

    expect(model.hidden).toEqual([]);
  });
});
