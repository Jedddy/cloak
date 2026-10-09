import { describe, expect, test } from "bun:test";

import type { FileEntry, Finding } from "@/lib/contract/schemas";

import { findRelatedExact, inconsistentRedactions } from "./related";

function fileEntry(overrides: Partial<FileEntry>): FileEntry {
  return {
    id: "file-1",
    originalName: "notes.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: 10,
    sha256: "a".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "skipped-no-model",
    excluded: false,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "fnd-1",
    fileId: "file-1",
    category: "protected-term",
    detections: [],
    title: "Protected term: Juniper",
    reason: "You marked this term as sensitive for this package.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: "rel-juniper",
    ...overrides,
  };
}

describe("findRelatedExact", () => {
  test("returns every exact match across text and ocr sources", async () => {
    const candidates = await findRelatedExact({
      term: "Juniper",
      sources: [
        { fileId: "file-notes", fileName: "notes.md", text: "Juniper twice: Juniper.", ocrWords: null },
        {
          fileId: "file-shot",
          fileName: "shot.png",
          text: "Juniper",
          ocrWords: [{ text: "Juniper", box: { x: 240, y: 8, w: 70, h: 18 }, confidence: 91, line: 0 }],
        },
        { fileId: "file-spec", fileName: "spec.md", text: "Nothing here.", ocrWords: null },
      ],
    });

    expect(candidates).toHaveLength(3);
    expect(candidates.every((item) => item.relatedGroupId === "rel-juniper")).toBe(true);

    const regions = candidates.flatMap((item) => item.detections.flatMap((detection) => detection.evidence));

    expect(regions).toContainEqual({
      type: "image-region",
      box: { x: 240, y: 8, w: 70, h: 18 },
      quote: "Juniper",
    });
  });

  test("returns nothing for a blank term", async () => {
    const candidates = await findRelatedExact({
      term: "   ",
      sources: [{ fileId: "file-1", fileName: "notes.md", text: "Juniper", ocrWords: null }],
    });

    expect(candidates).toEqual([]);
  });
});

describe("inconsistentRedactions", () => {
  test("AE3: warns when a term is redacted in one file and open in another", () => {
    const warnings = inconsistentRedactions({
      findings: [
        finding({ id: "fnd-notes", fileId: "file-notes", decision: "redact" }),
        finding({ id: "fnd-shot", fileId: "file-shot", decision: "open" }),
      ],
      protectedTerms: ["Juniper"],
      files: [
        fileEntry({ id: "file-notes", originalName: "notes.md" }),
        fileEntry({ id: "file-shot", originalName: "screenshot-01.png", kind: "image", mime: "image/png" }),
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      type: "inconsistent-redaction",
      term: "Juniper",
      relatedGroupId: "rel-juniper",
      redactedFileIds: ["file-notes"],
      visibleFileIds: ["file-shot"],
      message: "'Juniper' is redacted in notes.md but still visible in screenshot-01.png.",
    });
  });

  test("stays quiet when everything is redacted or not-an-issue", () => {
    const warnings = inconsistentRedactions({
      findings: [
        finding({ fileId: "file-a", decision: "redact" }),
        finding({ fileId: "file-b", decision: "not-an-issue" }),
      ],
      protectedTerms: ["Juniper"],
      files: [fileEntry({ id: "file-a" }), fileEntry({ id: "file-b" })],
    });

    expect(warnings).toEqual([]);
  });

  test("ignores excluded files", () => {
    const warnings = inconsistentRedactions({
      findings: [
        finding({ fileId: "file-a", decision: "redact" }),
        finding({ fileId: "file-b", decision: "open" }),
      ],
      protectedTerms: ["Juniper"],
      files: [fileEntry({ id: "file-a" }), fileEntry({ id: "file-b", excluded: true })],
    });

    expect(warnings).toEqual([]);
  });
});
