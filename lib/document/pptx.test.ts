import { describe, expect, test } from "bun:test";

import type { DocumentModel } from "@/lib/contract/schemas";

import { buildPptx, type PptxOptions } from "./fixtures/ooxml";
import { extractOoxml } from "./ooxml";

async function extract(options: PptxOptions): Promise<DocumentModel> {
  return extractOoxml({ fileName: "a.pptx", format: "pptx", bytes: await buildPptx(options) });
}

describe("pptx extraction", () => {
  test("AE6: slide 3 notes are their own section", async () => {
    const model = await extract({
      slides: [{ texts: ["One"] }, { texts: ["Two"] }, { texts: ["Three"], notes: "don't mention the Globex discount" }],
    });

    const notes = model.sections.find((section) => section.title === "Slide 3 notes");
    const segment = model.segments.find((entry) => entry.part === "ppt/notesSlides/notesSlide3.xml");

    expect(notes?.items).toHaveLength(1);
    expect(model.text.slice(notes?.items[0].start, notes?.items[0].end)).toBe("don't mention the Globex discount");
    expect(segment).toMatchObject({ node: 0, cell: null });
    expect(model.sections.slice(0, 3).map((section) => section.title)).toEqual(["Slide 1", "Slide 2", "Slide 3"]);
  });

  test("layout and master text come after slides and notes", async () => {
    const model = await extract({ slides: [{ texts: ["One"], notes: "N" }] });

    expect(model.sections.map((section) => section.title)).toEqual(["Slide 1", "Slide 1 notes", "Layout: Fixture layout", "Master 1"]);
    expect(model.text).toContain("Master title");
  });

  test("a hidden slide is a hidden item keyed by its slide id, and its text stays", async () => {
    const model = await extract({ slides: [{ texts: ["Public"] }, { texts: ["Draft pricing"], hidden: true }] });

    expect(model.hidden).toEqual([
      { id: "slide-257", kind: "hidden-slide", note: "Hidden slide 2", quote: null, category: "hidden-data" },
    ]);
    expect(model.text).toContain("Draft pricing");
    expect(model.sections.find((section) => section.title === "Slide 2")?.hidden).toBe(true);
  });

  test("comments name their author and their text is in a Comments section", async () => {
    const model = await extract({
      slides: [{ texts: ["One"] }],
      comments: [{ slide: 1, author: "J. Cruz", text: "Cut this slide" }],
    });

    expect(model.hidden).toEqual([
      {
        id: "comments-ppt/comments/comment1.xml",
        kind: "comment",
        note: "Comments by J. Cruz",
        quote: "J. Cruz",
        category: "hidden-data",
      },
    ]);
    expect(model.sections.map((section) => section.title)).toContain("Comments");
    expect(model.text).toContain("Cut this slide");
  });
});
