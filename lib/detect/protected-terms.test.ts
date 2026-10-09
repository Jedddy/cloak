import { describe, expect, test } from "bun:test";

import { protectedTerms, scanTerm, slugTerm } from "./protected-terms";

describe("slugTerm", () => {
  test("builds a stable group id", () => {
    expect(slugTerm("Juniper")).toBe("rel-juniper");
    expect(slugTerm("Acme Corp")).toBe("rel-acme-corp");
    expect(slugTerm("  ")).toBe("rel-term");
  });
});

describe("scanTerm", () => {
  test("matches case-insensitively on word boundaries", () => {
    expect(scanTerm("Project Juniper budget", "juniper")).toHaveLength(1);
    expect(scanTerm("Project Junipers budget", "juniper")).toHaveLength(0);
    expect(scanTerm("JUNIPER and juniper", "Juniper")).toHaveLength(2);
  });

  test("matches multi-word terms", () => {
    expect(scanTerm("for Acme Corp today", "Acme Corp")).toHaveLength(1);
  });

  test("ignores blank terms", () => {
    expect(scanTerm("some text", "   ")).toEqual([]);
  });
});

describe("protectedTerms", () => {
  test("finds protected terms in text with a shared group id", async () => {
    const candidates = await protectedTerms({
      fileId: "f1",
      fileName: "notes.md",
      text: "Project Juniper costs. Juniper again.",
      ocrWords: null,
      protectedTerms: ["Juniper"],
      otherClientNames: [],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.category).toBe("protected-term");
    expect(candidates[0]?.relatedGroupId).toBe("rel-juniper");
    expect(candidates[1]?.relatedGroupId).toBe("rel-juniper");
  });

  test("checks other-client names with the other-client category", async () => {
    const candidates = await protectedTerms({
      fileId: "f1",
      fileName: "notes.md",
      text: "Built for Acme Corp.",
      ocrWords: null,
      protectedTerms: [],
      otherClientNames: ["Acme Corp", "Northwind Studio"],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.category).toBe("other-client");
    expect(candidates[0]?.title).toBe("Other client: Acme Corp");
  });

  test("maps a multi-word term to the union of ocr word boxes", async () => {
    const candidates = await protectedTerms({
      fileId: "f2",
      fileName: "shot.png",
      text: "Acme Corp Juniper",
      ocrWords: [
        { text: "Acme", box: { x: 112, y: 8, w: 52, h: 18 }, confidence: 94, line: 0 },
        { text: "Corp", box: { x: 168, y: 8, w: 48, h: 18 }, confidence: 93, line: 0 },
        { text: "Juniper", box: { x: 240, y: 8, w: 70, h: 18 }, confidence: 91, line: 0 },
      ],
      protectedTerms: ["Juniper"],
      otherClientNames: ["Acme Corp"],
    });

    const evidence = candidates.flatMap((candidate) => candidate.detections.flatMap((detection) => detection.evidence));

    expect(candidates).toHaveLength(2);
    expect(evidence).toContainEqual({
      type: "image-region",
      box: { x: 112, y: 8, w: 104, h: 18 },
      quote: "Acme Corp",
    });
    expect(evidence).toContainEqual({
      type: "image-region",
      box: { x: 240, y: 8, w: 70, h: 18 },
      quote: "Juniper",
    });
  });

  test("returns nothing when no term matches", async () => {
    const candidates = await protectedTerms({
      fileId: "f1",
      fileName: "spec.md",
      text: "A normal specification.",
      ocrWords: null,
      protectedTerms: ["Juniper"],
      otherClientNames: ["Acme Corp"],
    });

    expect(candidates).toEqual([]);
  });
});
