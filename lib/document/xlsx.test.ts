import { describe, expect, test } from "bun:test";

import type { DocumentModel } from "@/lib/contract/schemas";

import { buildXlsx, type XlsxOptions } from "./fixtures/ooxml";
import { extractOoxml } from "./ooxml";

async function extract(options: XlsxOptions): Promise<DocumentModel> {
  return extractOoxml({ fileName: "a.xlsx", format: "xlsx", bytes: await buildXlsx(options) });
}

describe("xlsx extraction", () => {
  test("AE5: a formula with an external reference shows the file name, the cached value, and an external link item", async () => {
    const model = await extract({
      sheets: [{ name: "Sheet1", cells: { A1: { text: "Rate" }, B4: { formula: "[1]Sheet1!A1*2", number: 42 } } }],
      externalLinks: ["file:///C:/Clients/ClientX_rates.xlsx"],
    });

    expect(model.text).toContain("=[ClientX_rates.xlsx]Sheet1!A1*2 42");
    expect(model.hidden).toEqual([
      {
        id: expect.stringMatching(/^extlink-/),
        kind: "external-link",
        note: "External link to ClientX_rates.xlsx",
        quote: "ClientX_rates.xlsx",
        category: "hidden-data",
      },
    ]);

    const item = model.sections[0].items.find((entry) => entry.label === "Sheet1!B4");
    const segment = model.segments.find((entry) => entry.cell === "B4");

    expect(item).toMatchObject({ row: 3, col: 1 });
    expect(segment).toMatchObject({ start: item?.start, end: item?.end, part: "xl/worksheets/sheet1.xml", node: -1 });
  });

  test("defined names that point at an external workbook go in the link note", async () => {
    const model = await extract({
      sheets: [{ name: "Sheet1", cells: { A1: { number: 1 } } }],
      externalLinks: ["ClientX_rates.xlsx"],
      definedNames: [{ name: "Rate", ref: "[1]Sheet1!$A$1" }],
    });

    expect(model.hidden[0].note).toBe("External link to ClientX_rates.xlsx, used by defined name 'Rate'");
  });

  test("a veryHidden sheet is a hidden item and its cells stay in the text", async () => {
    const model = await extract({
      sheets: [
        { name: "Summary", cells: { A1: { text: "Public" } } },
        { name: "Margins", state: "veryHidden", cells: { A1: { text: "Margin 31%" } } },
      ],
    });

    expect(model.hidden).toEqual([
      { id: "sheet-Margins", kind: "hidden-sheet", note: "Hidden sheet 'Margins'", quote: "Margins", category: "hidden-data" },
    ]);
    expect(model.text).toContain("Margin 31%");
    expect(model.sections.map((section) => [section.title, section.hidden])).toEqual([
      ["Summary", false],
      ["Margins", true],
    ]);
  });

  test("hidden rows and columns are one item per sheet", async () => {
    const model = await extract({
      sheets: [{ name: "Costs", cells: { A1: { text: "a" }, A2: { text: "b" }, A3: { text: "c" } }, hiddenRows: [2, 3], hiddenCols: [[2, 3]] }],
    });

    expect(model.hidden.map((item) => [item.id, item.kind, item.note])).toEqual([
      ["rows-Costs", "hidden-rows", "Hidden rows in sheet 'Costs': 2, 3"],
      ["cols-Costs", "hidden-rows", "Hidden columns in sheet 'Costs': B-C"],
    ]);
  });

  test("comments become a hidden item and a Comments section with node segments", async () => {
    const model = await extract({
      sheets: [{ name: "Costs", cells: { A1: { text: "a" } }, comments: [{ ref: "A1", author: "J. Cruz", text: "Ask Globex" }] }],
    });

    expect(model.hidden).toEqual([
      {
        id: "comments-xl/comments1.xml",
        kind: "comment",
        note: "Comments in sheet 'Costs' by J. Cruz",
        quote: "J. Cruz",
        category: "hidden-data",
      },
    ]);

    const segment = model.segments.find((entry) => entry.part === "xl/comments1.xml");

    expect(model.text.slice(segment?.start, segment?.end)).toBe("Ask Globex");
    expect(segment).toMatchObject({ node: 0, cell: null });
    expect(model.sections.map((section) => section.title)).toEqual(["Costs", "Comments: Costs"]);
  });

  test("defined names are text in a Defined names section and one hidden item each", async () => {
    const model = await extract({
      sheets: [{ name: "Sheet1", cells: { A1: { text: "x" } } }],
      definedNames: [
        { name: "ClientXRate", ref: "Sheet1!$A$1" },
        { name: "_xlnm.Print_Area", ref: "Sheet1!$A$1:$B$2", localSheetId: 0 },
      ],
    });

    const section = model.sections.find((entry) => entry.title === "Defined names");
    const texts = section?.items.map((item) => model.text.slice(item.start, item.end));

    expect(texts).toEqual(["ClientXRate = Sheet1!$A$1", "_xlnm.Print_Area = Sheet1!$A$1:$B$2"]);
    expect(model.segments.filter((segment) => segment.part === "xl/workbook.xml")).toHaveLength(4);
    expect(model.hidden).toEqual([
      {
        id: "name-ClientXRate",
        kind: "defined-name",
        note: "Defined name 'ClientXRate' = Sheet1!$A$1",
        quote: "ClientXRate",
        category: "hidden-data",
      },
    ]);
  });

  test("a pivot cache is a hidden item naming its source, not a not-analysed entry", async () => {
    const model = await extract({
      sheets: [{ name: "Margins", cells: { A1: { text: "x" } } }],
      pivotCaches: [{ sheet: "Margins", secret: "s" }, { name: "SomeTable", secret: "s" }],
    });

    expect(model.hidden).toEqual([
      { id: "pivot-xl/pivotCache/pivotCacheDefinition1.xml", kind: "pivot-cache", note: "Pivot cache from Margins", quote: "Margins", category: "hidden-data" },
      { id: "pivot-xl/pivotCache/pivotCacheDefinition2.xml", kind: "pivot-cache", note: "Pivot cache from SomeTable", quote: null, category: "hidden-data" },
    ]);
    expect(model.notAnalysed).toEqual([]);
  });
});
