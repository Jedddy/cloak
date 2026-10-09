import { describe, expect, test } from "bun:test";

import { mkdir, writeFile } from "node:fs/promises";

import JSZip from "jszip";
import sharp from "sharp";

import type { DocumentFormat, DocumentModel } from "@/lib/contract/schemas";

import { buildDocx, buildPptx, buildXlsx, tinyPng } from "./fixtures/ooxml";
import { extractOoxml } from "./ooxml";
import { redactOoxml } from "./ooxml-redact";

type Options = {
  /** Texts to redact: the first occurrence of each in model.text. */
  spans?: string[];
  /** Hidden item ids; "all" removes every hidden item. */
  hidden?: string[] | "all";
  regions?: { anchor: string; box: { x: number; y: number; w: number; h: number } }[];
  /** Adjusts the model before redaction, for example to add OCR words. */
  prepare?: (model: DocumentModel) => DocumentModel;
};

async function run(format: DocumentFormat, bytes: Uint8Array, options: Options = {}) {
  const input = { fileName: `a.${format}`, format, bytes };
  const scanned = await extractOoxml(input);
  const model = options.prepare ? options.prepare(scanned) : scanned;
  const removeHidden = options.hidden === "all" ? model.hidden.map((item) => item.id) : (options.hidden ?? []);

  const spans = (options.spans ?? []).map((text) => {
    const start = model.text.indexOf(text);

    expect(start).toBeGreaterThanOrEqual(0);

    return { start, end: start + text.length };
  });

  const result = await redactOoxml({ ...input, model, spans, regions: options.regions ?? [], removeHidden });
  const zip = await JSZip.loadAsync(result.bytes);
  const parts = new Map<string, string>();

  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) {
      parts.set(name, await zip.files[name].async("string"));
    }
  }

  const after = await extractOoxml({ ...input, bytes: result.bytes });

  return { ...result, zip, parts, model, after };
}

const everywhere = (parts: Map<string, string>, needle: string) => [...parts].flatMap(([name, text]) => (text.includes(needle) ? [name] : []));

describe("docx redaction", () => {
  test("AE4: removing both tracked insertions and the comment leaves no revision or comment trace", async () => {
    const bytes = await buildDocx({
      paragraphs: ["Kept paragraph"],
      insertions: [
        { id: 1, author: "J. Cruz", text: "Added one" },
        { id: 2, author: "J. Cruz", text: "Added two" },
      ],
      comments: [{ id: 7, author: "J. Cruz", text: "Check this" }],
      author: "J. Cruz",
      lastModifiedBy: "J. Cruz",
    });

    const out = await run("docx", bytes, { hidden: "all" });
    const document = out.parts.get("word/document.xml") ?? "";

    expect(out.model.hidden.filter((item) => item.id !== "metadata")).toHaveLength(3);
    expect(document).not.toContain("<w:ins");
    expect(document).not.toContain("<w:del");
    expect(document).not.toContain("commentRange");
    expect(document).not.toContain("commentReference");
    expect(document).toContain("Added one");
    expect(document).toContain("Kept paragraph");
    expect([...out.parts.keys()].filter((name) => /comments|people/.test(name))).toEqual([]);
    expect(everywhere(out.parts, "J. Cruz")).toEqual([]);
    expect(out.parts.get("word/_rels/document.xml.rels")).not.toContain("comments");
    expect(out.parts.get("[Content_Types].xml")).not.toContain("comments");
    expect(out.after.hidden).toEqual([]);
  });

  test("deletions are dropped with their text and one comment can go while another stays", async () => {
    const bytes = await buildDocx({
      paragraphs: ["Body"],
      deletions: [{ id: 3, author: "Ann", text: "Old figure" }],
      comments: [
        { id: 1, author: "Ann", text: "First" },
        { id: 2, author: "Bea", text: "Second" },
      ],
    });

    const out = await run("docx", bytes, { hidden: ["del-3", "comment-1"] });

    expect(everywhere(out.parts, "Old figure")).toEqual([]);
    expect(everywhere(out.parts, "Ann")).toEqual([]);
    expect(out.parts.get("word/comments.xml")).toContain("Second");
    expect(out.parts.get("word/document.xml")).toContain('w:id="2"');
    expect(out.parts.get("word/document.xml")).not.toContain('w:id="1"');
  });

  test("a span crossing three runs leaves exactly one placeholder and no fragment", async () => {
    const bytes = await buildDocx({ splitRuns: ["Visit Ac", "me Co", "rp today"] });
    const out = await run("docx", bytes, { spans: ["Acme Corp"] });
    const text = out.after.text;

    expect(text).toBe("Visit [REDACTED] today");
    expect(text.match(/\[REDACTED\]/g)).toHaveLength(1);
    expect(everywhere(out.parts, "Acme")).toEqual([]);
    expect(out.parts.get("word/document.xml")).not.toMatch(/>(Ac|me Co|rp)</);
  });

  test("hidden text runs and external links are removed", async () => {
    const bytes = await buildDocx({
      paragraphs: ["Public"],
      vanishRun: "secret vanish",
      whiteRun: "secret white",
      hyperlink: "https://intranet.example.test/page",
    });

    const out = await run("docx", bytes, { hidden: "all" });

    expect(everywhere(out.parts, "secret")).toEqual([]);
    expect(everywhere(out.parts, "intranet.example.test")).toEqual([]);
    expect(out.after.text).toContain("A link");
    expect(out.parts.get("word/document.xml")).not.toContain("hyperlink");
    expect(out.after.hidden).toEqual([]);
  });

  test("removing formatting revisions and moves leaves no author, drops moved-from text and keeps moved-to text", async () => {
    const bytes = await buildDocx({
      paragraphs: ["Kept paragraph"],
      formatChanges: [{ id: 21, author: "J. Cruz", text: "Bold words" }],
      moves: [{ id: 3, author: "J. Cruz", from: "Moved secret text", to: "Relocated paragraph" }],
    });

    const out = await run("docx", bytes, { hidden: "all" });

    expect(everywhere(out.parts, "J. Cruz")).toEqual([]);
    expect(everywhere(out.parts, "Moved secret text")).toEqual([]);

    const document = out.parts.get("word/document.xml") ?? "";

    expect(document).not.toMatch(/PrChange|move(From|To)/);
    expect(document).toContain("Relocated paragraph");
    expect(document).toContain("Bold words");
    expect(document).toContain("<w:b/>");
    expect(out.after.text).toContain("Relocated paragraph");
    expect(out.after.hidden).toEqual([]);
  });

  test("field link items empty the instruction but keep the displayed result", async () => {
    const bytes = await buildDocx({
      fields: [{ instr: ' HYPERLINK "https://intranet.clientx.example/wiki" ', result: "Click here", split: true }, { instr: " PAGE ", result: "1" }],
      simpleFields: [{ instr: 'INCLUDETEXT "clientx-notes.docx"', result: "Included text" }],
    });

    const out = await run("docx", bytes, { hidden: "all" });

    expect(everywhere(out.parts, "clientx")).toEqual([]);
    expect(everywhere(out.parts, "HYPERLINK")).toEqual([]);

    const document = out.parts.get("word/document.xml") ?? "";

    expect(document).toContain("Click here");
    expect(document).toContain("Included text");
    expect(document).toContain("PAGE");
    expect(document).not.toContain("fldSimple");
    expect(out.after.hidden).toEqual([]);
  });

  test("a span over a field instruction is redacted in its instrText nodes, and in a fldSimple attribute", async () => {
    const bytes = await buildDocx({
      fields: [{ instr: " MERGEFIELD AcmeCorpSecret ", result: "Value", split: true }],
      simpleFields: [{ instr: " MERGEFIELD AcmeCorpOther ", result: "Other value" }],
    });

    const out = await run("docx", bytes, { spans: ["MERGEFIELD AcmeCorpSecret", "AcmeCorpOther"] });

    expect(everywhere(out.parts, "AcmeCorp")).toEqual([]);
    expect(out.parts.get("word/document.xml")).toContain("[REDACTED]");
    expect(out.parts.get("word/document.xml")).toContain("Value");
  });

  test("a redacted quote in a chart removes the chart and leaves [Object removed]", async () => {
    const bytes = await buildDocx({ paragraphs: ["Client is Globex Corp"], chart: "Globex Corp revenue" });
    const out = await run("docx", bytes, { spans: ["Globex Corp"] });

    expect([...out.parts.keys()].filter((name) => name.includes("chart"))).toEqual([]);
    expect(out.after.text).toContain("[Object removed]");
    expect(out.parts.get("word/document.xml")).not.toContain("w:drawing");
    expect(out.parts.get("word/_rels/document.xml.rels")).not.toContain("chart");
    expect(out.parts.get("[Content_Types].xml")).not.toContain("chart");
    expect(out.notes).toEqual([
      { kind: "object-removed", note: "a.docx: Chart word/charts/chart1.xml removed: it contained redacted text." },
    ]);
  });

  test("a chart without the redacted quote stays", async () => {
    const bytes = await buildDocx({ paragraphs: ["Client is Globex Corp"], chart: "Revenue" });
    const out = await run("docx", bytes, { spans: ["Globex Corp"] });

    expect(out.parts.has("word/charts/chart1.xml")).toBe(true);
    expect(out.notes).toEqual([]);
  });

  test("a span inside an embedded image's OCR text paints the word boxes on the image", async () => {
    const bytes = await buildDocx({ image: true });

    const prepare = (model: DocumentModel): DocumentModel => ({
      ...model,
      text: "Name: Ada",
      words: [{ text: "Ada", start: 6, end: 9, anchor: "image:word/media/image1.png", box: { x: 0, y: 0, w: 4, h: 4 } }],
    });

    const out = await run("docx", bytes, { prepare, spans: ["Ada"] });
    const pixels = await sharp(await out.zip.file("word/media/image1.png")!.async("uint8array")).raw().toBuffer();
    const original = await sharp(await tinyPng()).raw().toBuffer();

    expect([...original.subarray(0, 3)]).toEqual([0x33, 0x66, 0x99]);
    expect([...pixels.subarray(0, 3)]).toEqual([0, 0, 0]);
  });

  test("an anchored image region paints that image", async () => {
    const bytes = await buildDocx({ image: true });

    const out = await run("docx", bytes, {
      regions: [{ anchor: "image:word/media/image1.png", box: { x: 0, y: 0, w: 4, h: 4 } }],
    });

    const pixels = await sharp(await out.zip.file("word/media/image1.png")!.async("uint8array")).raw().toBuffer();

    expect([...pixels.subarray(0, 3)]).toEqual([0, 0, 0]);
  });
});

describe("xlsx redaction", () => {
  const book = () =>
    buildXlsx({
      sheets: [
        {
          name: "Sheet1",
          cells: {
            A1: { text: "Acme Corp" },
            A2: { text: "Acme Corp" },
            A3: { text: "Kept note" },
            B4: { formula: "[1]Sheet1!A1", number: 4242 },
            C4: { formula: "B4*2", number: 8484 },
            D4: { formula: "SUM($B$1:B5)", number: 1 },
            E4: { formula: "Other!A1+1", number: 2 },
          },
        },
        { name: "Other", cells: { A1: { formula: "Sheet1!B4+1", number: 4243 }, A2: { formula: "Sheet1!B9", number: 0 } } },
      ],
      externalLinks: ["ClientX_rates.xlsx"],
      author: "J. Cruz",
    });

  test("AE5: redacting B4 removes its formula and cached value and flags dependents", async () => {
    const out = await run("xlsx", await book(), { spans: ["=[ClientX_rates.xlsx]Sheet1!A1 4242"] });
    const sheet = out.parts.get("xl/worksheets/sheet1.xml") ?? "";
    const cell = /<c r="B4"[^>]*>.*?<\/c>/.exec(sheet)?.[0] ?? "";

    expect(cell).toContain('t="inlineStr"');
    expect(cell).toContain("<is><t>[REDACTED]</t></is>");
    expect(cell).not.toContain("<f");
    expect(cell).not.toContain("<v>");
    expect(sheet).not.toContain("4242");
    expect(out.notes.map((note) => note.note).sort()).toEqual([
      "a.xlsx: Other!A1 uses redacted cell Sheet1!B4; its formula was not rewritten.",
      "a.xlsx: Sheet1!C4 uses redacted cell Sheet1!B4; its formula was not rewritten.",
      "a.xlsx: Sheet1!D4 uses redacted cell Sheet1!B4; its formula was not rewritten.",
    ]);
    expect(out.notes.every((note) => note.kind === "formula-dependency")).toBe(true);
    expect(out.after.text).toContain("[REDACTED]");
  });

  test("a shared string used by a redacted and a kept cell keeps the kept cell and drops unused strings", async () => {
    const out = await run("xlsx", await book(), { spans: ["Acme Corp"] });

    expect(out.after.text.split("\n").slice(0, 3)).toEqual(["[REDACTED]", "Acme Corp", "Kept note"]);
  });

  test("a shared string nothing references any more is gone from sharedStrings.xml", async () => {
    const bytes = await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "Only Acme" }, A2: { text: "Other" } } }] });
    const out = await run("xlsx", bytes, { spans: ["Only Acme"] });
    const strings = out.parts.get("xl/sharedStrings.xml") ?? "";

    expect(strings).not.toContain("Acme");
    expect(strings).toContain("Other");
    expect(strings).toContain('uniqueCount="1"');
    expect(out.parts.get("xl/worksheets/sheet1.xml")).toContain("<v>0</v>");
    expect(out.after.text).toBe("[REDACTED]\nOther");
  });

  test("removing the hidden sheet Margins leaves no trace of it", async () => {
    const bytes = await buildXlsx({
      sheets: [
        { name: "Pricing", cells: { A1: { text: "Public" } } },
        { name: "Margins", state: "hidden", cells: { A1: { text: "40 percent" } }, comments: [{ ref: "A1", author: "Lee", text: "floor" }] },
      ],
      definedNames: [
        { name: "Floor", ref: "Margins!$A$1" },
        { name: "Scoped", ref: "Pricing!$A$1" },
      ],
    });

    const out = await run("xlsx", bytes, { hidden: ["sheet-Margins"] });

    expect(everywhere(out.parts, "Margins")).toEqual([]);
    expect(everywhere(out.parts, "40 percent")).toEqual([]);
    expect(everywhere(out.parts, "Lee")).toEqual([]);
    expect([...out.parts.keys()].filter((name) => /sheet2|comments|vmlDrawing/.test(name))).toEqual([]);
    expect(out.parts.get("xl/workbook.xml")).toContain("Scoped");
    expect(out.after.text).toBe("Public\n\nScoped = Pricing!$A$1");
  });

  test("removing a hidden sheet removes the pivot caches sourced from it, their records and pivot tables, and the output still converts", async () => {
    const bytes = await buildXlsx({
      sheets: [
        { name: "Pricing", cells: { A1: { text: "Public" } } },
        { name: "Margins", state: "hidden", cells: { A1: { text: "Margin" }, A2: { text: "SecretMarginValue" } } },
      ],
      definedNames: [{ name: "MarginData", ref: "Margins!$A$1:$A$2" }],
      pivotCaches: [
        { sheet: "Margins", secret: "SecretMarginValue", table: "Pricing" },
        { name: "MarginData", secret: "SecretMarginValue" },
        { sheet: "Pricing", secret: "PublicPivotValue", table: "Pricing" },
      ],
    });

    const out = await run("xlsx", bytes, { hidden: ["sheet-Margins"] });

    expect(everywhere(out.parts, "SecretMarginValue")).toEqual([]);
    expect(everywhere(out.parts, "Margins")).toEqual([]);
    expect([...out.parts.keys()].filter((name) => /pivot/i.test(name)).sort()).toEqual([
      "xl/pivotCache/_rels/pivotCacheDefinition3.xml.rels",
      "xl/pivotCache/pivotCacheDefinition3.xml",
      "xl/pivotCache/pivotCacheRecords3.xml",
      "xl/pivotTables/_rels/pivotTable3.xml.rels",
      "xl/pivotTables/pivotTable3.xml",
    ]);
    expect(out.parts.get("xl/workbook.xml")).toContain('cacheId="3"');
    expect(out.parts.get("xl/workbook.xml")).not.toContain('cacheId="1"');
    expect(out.parts.get("xl/worksheets/_rels/sheet1.xml.rels")).not.toContain("pivotTable1");
    expect(out.after.text).toContain("Public");

    const directory = "/tmp/claude-0/-home-user-cloak/825218fb-061d-55c2-b6ba-e139655a7d62/scratchpad/pivot-convert";

    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/out.xlsx`, out.bytes);

    const converted = Bun.spawnSync(["soffice", "--headless", "--convert-to", "csv", "--outdir", directory, `${directory}/out.xlsx`], { env: { ...process.env, HOME: directory } });
    const csv = await Bun.file(`${directory}/out.csv`).text();

    expect(converted.exitCode).toBe(0);
    expect(csv).toContain("Public");
  }, 60000);

  test("removing hidden rows and columns flags formulas that read the dropped cells", async () => {
    const bytes = await buildXlsx({
      sheets: [
        {
          name: "S",
          cells: { A1: { text: "Shown" }, A2: { number: 99 }, B1: { formula: "A2*2", number: 198 }, C1: { number: 5 }, D1: { formula: "C1+1", number: 6 }, E1: { formula: "A1", text: "Shown" } },
          hiddenRows: [2],
          hiddenCols: [[3, 3]],
        },
      ],
    });

    const out = await run("xlsx", bytes, { hidden: "all" });

    expect(out.notes.map((note) => note.note).sort()).toEqual([
      "a.xlsx: S!B1 uses redacted cell S!A2; its formula was not rewritten.",
      "a.xlsx: S!D1 uses redacted cell S!C1; its formula was not rewritten.",
    ]);
    expect(out.notes.every((note) => note.kind === "formula-dependency")).toBe(true);
  });

  test("defined names that hold redacted text are removed and flagged", async () => {
    const bytes = await buildXlsx({
      sheets: [{ name: "S", cells: { A1: { text: "x" } } }],
      definedNames: [
        { name: "ClientXRate", ref: "S!$A$1" },
        { name: "Other", ref: "S!$A$1" },
      ],
    });

    const out = await run("xlsx", bytes, { spans: ["ClientXRate"] });

    expect(everywhere(out.parts, "ClientXRate")).toEqual([]);
    expect(out.parts.get("xl/workbook.xml")).toContain("Other");
    expect(out.notes).toEqual([
      { kind: "formula-dependency", note: "a.xlsx: defined name 'ClientXRate' was removed because it contained redacted text; formulas that use it may not calculate." },
    ]);
  });

  test("removing a defined name item and a pivot cache item removes just those", async () => {
    const bytes = await buildXlsx({
      sheets: [{ name: "S", cells: { A1: { text: "x" } } }],
      definedNames: [
        { name: "Keep", ref: "S!$A$1" },
        { name: "DropMe", ref: "S!$A$1" },
      ],
      pivotCaches: [{ sheet: "S", secret: "PivotSecretValue", table: "S" }],
    });

    const scanned = await extractOoxml({ fileName: "a.xlsx", format: "xlsx", bytes });
    const ids = scanned.hidden.filter((item) => item.kind === "defined-name" || item.kind === "pivot-cache").map((item) => item.id);
    const dropName = scanned.hidden.find((item) => item.quote === "DropMe")?.id ?? "";
    const dropPivot = scanned.hidden.find((item) => item.kind === "pivot-cache")?.id ?? "";

    expect(ids).toHaveLength(3);

    const out = await run("xlsx", bytes, { hidden: [dropName, dropPivot] });

    expect(everywhere(out.parts, "DropMe")).toEqual([]);
    expect(everywhere(out.parts, "PivotSecretValue")).toEqual([]);
    expect(out.parts.get("xl/workbook.xml")).toContain("Keep");
    expect([...out.parts.keys()].filter((name) => /pivot/i.test(name))).toEqual([]);
    expect(out.after.hidden.map((item) => item.quote)).toEqual(["Keep"]);
  });

  test("a sheet scoped defined name moves down when an earlier sheet goes", async () => {
    const bytes = await buildXlsx({
      sheets: [
        { name: "Margins", state: "hidden", cells: { A1: { text: "x" } } },
        { name: "Pricing", cells: { A1: { text: "Public" } } },
      ],
    });

    const zip = await JSZip.loadAsync(bytes);

    const workbook = (await zip.file("xl/workbook.xml")!.async("string")).replace(
      "</workbook>",
      '<definedNames><definedName name="Local" localSheetId="1">Pricing!$A$1</definedName><definedName name="Gone" localSheetId="0">Margins!$A$1</definedName></definedNames></workbook>',
    );

    zip.file("xl/workbook.xml", workbook);

    const out = await run("xlsx", await zip.generateAsync({ type: "uint8array" }), { hidden: ["sheet-Margins"] });
    const result = out.parts.get("xl/workbook.xml") ?? "";

    expect(result).toContain('localSheetId="0"');
    expect(result).not.toContain("Gone");
  });

  test("hidden rows and columns are cleared and comments go with their drawing", async () => {
    const bytes = await buildXlsx({
      sheets: [
        {
          name: "S",
          cells: { A1: { text: "visible" }, A2: { text: "row secret" }, B1: { text: "col secret" }, C1: { text: "also visible" } },
          hiddenRows: [2],
          hiddenCols: [[2, 2]],
          comments: [{ ref: "A1", author: "Lee", text: "note" }],
        },
      ],
    });

    const out = await run("xlsx", bytes, { hidden: "all" });

    expect(out.after.text).toBe("visible\nalso visible");
    expect(everywhere(out.parts, "secret")).toEqual([]);
    expect(everywhere(out.parts, "Lee")).toEqual([]);
    expect(out.parts.get("xl/worksheets/sheet1.xml")).not.toContain("legacyDrawing");
    expect([...out.parts.keys()].filter((name) => /comments|vml/.test(name))).toEqual([]);
  });

  test("an external link keeps cached values, drops formulas and renumbers the rest", async () => {
    const bytes = await buildXlsx({
      sheets: [
        {
          name: "S",
          cells: { A1: { formula: "[1]Sheet1!A1", number: 10 }, A2: { formula: "[2]Sheet1!A1", number: 20 }, A3: { formula: "A1+1", number: 11 } },
        },
      ],
      externalLinks: ["ClientX_rates.xlsx", "Other_rates.xlsx"],
      definedNames: [{ name: "Rate", ref: "[1]Sheet1!$A$1" }],
    });

    const model = await extractOoxml({ fileName: "a.xlsx", format: "xlsx", bytes });
    const id = model.hidden.find((item) => item.note.includes("ClientX"))?.id ?? "";
    const out = await run("xlsx", bytes, { hidden: [id] });
    const sheet = out.parts.get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("<v>10</v>");
    expect(sheet).not.toContain("ClientX");
    expect(out.after.text).toBe("10\n=[Other_rates.xlsx]Sheet1!A1 20\n=A1+1 11");
    expect(everywhere(out.parts, "ClientX")).toEqual([]);
    expect(out.parts.has("xl/externalLinks/externalLink1.xml")).toBe(false);
    expect(out.parts.has("xl/externalLinks/externalLink2.xml")).toBe(true);
    expect(out.parts.get("xl/workbook.xml")).not.toContain("Rate");
  });

  test("a redacted quote in a sheet chart removes the chart and leaves a text box", async () => {
    const bytes = await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "Globex Corp" } }, chart: "Globex Corp totals" }] });
    const out = await run("xlsx", bytes, { spans: ["Globex Corp"] });
    const drawing = out.parts.get("xl/drawings/drawing1.xml") ?? "";

    expect([...out.parts.keys()].filter((name) => name.includes("chart"))).toEqual([]);
    expect(drawing).toContain("[Object removed]");
    expect(drawing).not.toContain("graphicFrame");
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].kind).toBe("object-removed");
  });
});

describe("pptx redaction", () => {
  test("removing a hidden slide leaves one fewer slide and no notes for it", async () => {
    const bytes = await buildPptx({
      slides: [{ texts: ["Public"], notes: "public notes" }, { texts: ["Draft pricing"], notes: "secret notes", hidden: true }],
      comments: [{ slide: 2, author: "J. Cruz", text: "Cut it" }],
    });

    const out = await run("pptx", bytes, { hidden: ["slide-257"] });

    expect(out.after.sections.filter((section) => /^Slide \d+$/.test(section.title))).toHaveLength(1);
    expect(everywhere(out.parts, "Draft pricing")).toEqual([]);
    expect(everywhere(out.parts, "secret notes")).toEqual([]);
    expect(out.parts.has("ppt/slides/slide2.xml")).toBe(false);
    expect(out.parts.has("ppt/notesSlides/notesSlide2.xml")).toBe(false);
    expect(out.parts.get("[Content_Types].xml")).not.toContain("slide2.xml");
    expect(out.parts.get("ppt/presentation.xml")).not.toContain("257");
  });

  test("comments are removed with their authors part when none remain", async () => {
    const bytes = await buildPptx({
      slides: [{ texts: ["One"] }, { texts: ["Two"] }],
      comments: [{ slide: 1, author: "J. Cruz", text: "Cut this" }],
    });

    const out = await run("pptx", bytes, { hidden: "all" });

    expect(everywhere(out.parts, "J. Cruz")).toEqual([]);
    expect([...out.parts.keys()].filter((name) => /comment/i.test(name))).toEqual([]);
    expect(out.after.text).toContain("One");
  });

  test("span redaction replaces text in slides and notes", async () => {
    const bytes = await buildPptx({ slides: [{ texts: ["Call Ada Lovelace now"], notes: "Ada is key" }] });
    const out = await run("pptx", bytes, { spans: ["Ada Lovelace", "Ada is"] });

    expect(out.after.text).toContain("Call [REDACTED] now");
    expect(out.after.text).toContain("[REDACTED] key");
    expect(everywhere(out.parts, "Ada")).toEqual([]);
  });

  test("a redacted quote in a slide chart replaces the frame with a text box at the same position", async () => {
    const bytes = await buildPptx({ slides: [{ texts: ["Globex Corp plan"], chart: "Globex Corp forecast" }] });
    const out = await run("pptx", bytes, { spans: ["Globex Corp"] });
    const slide = out.parts.get("ppt/slides/slide1.xml") ?? "";

    expect([...out.parts.keys()].filter((name) => name.includes("chart"))).toEqual([]);
    expect(slide).not.toContain("graphicFrame");
    expect(slide).toContain("[Object removed]");
    expect(slide).toContain('<a:off x="457200" y="1800000"/>');
    expect(out.notes[0]).toMatchObject({ kind: "object-removed" });
  });
});

describe("every output", () => {
  test("re-extracts, has no document properties, and drops calcChain", async () => {
    const outputs = [
      await run("docx", await buildDocx({ paragraphs: ["x"], author: "J. Cruz", lastModifiedBy: "J. Cruz" })),
      await run("xlsx", await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "x" } } }], author: "J. Cruz" })),
      await run("pptx", await buildPptx({ slides: [{ texts: ["x"] }], author: "J. Cruz" })),
    ];

    for (const out of outputs) {
      expect(out.parts.has("docProps/core.xml")).toBe(false);
      expect(out.parts.has("docProps/app.xml")).toBe(false);
      expect(out.parts.get("_rels/.rels")).not.toContain("docProps");
      expect(out.parts.get("[Content_Types].xml")).not.toContain("docProps");
      expect(everywhere(out.parts, "J. Cruz")).toEqual([]);
      expect(out.after.hidden).toEqual([]);
    }
  });

  test("custom properties, customXml and calcChain parts are removed with their relationships", async () => {
    const zip = await JSZip.loadAsync(await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "x" } } }] }));

    zip.file("docProps/custom.xml", "<Properties>secret-prop</Properties>");
    zip.file("customXml/item1.xml", "<x>secret-xml</x>");
    zip.file("xl/calcChain.xml", "<calcChain/>");
    zip.file(
      "_rels/.rels",
      (await zip.file("_rels/.rels")!.async("string")).replace(
        "</Relationships>",
        '<Relationship Id="rC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
      ),
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      (await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(
        "</Relationships>",
        '<Relationship Id="rCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
      ),
    );

    const out = await run("xlsx", await zip.generateAsync({ type: "uint8array" }));

    expect(everywhere(out.parts, "secret-")).toEqual([]);
    expect(out.parts.has("xl/calcChain.xml")).toBe(false);
    expect(out.parts.get("xl/_rels/workbook.xml.rels")).not.toContain("calcChain");
  });
});
