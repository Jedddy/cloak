import { describe, expect, test } from "bun:test";

import {
  CoverageReportSchema,
  FileEntrySchema,
  FindingSchema,
  ScanStartBodySchema,
  SettingsResponseSchema,
} from "./schemas";

const baseFinding = {
  id: "fnd-1",
  fileId: "file-1",
  category: "secret",
  title: "Possible access token",
  reason: "This can give access to an account.",
  suggestedAction: "redact",
  decision: "open",
  allowedByRecipient: false,
  relatedGroupId: null,
};

describe("FindingSchema", () => {
  test("parses a finding with each evidence variant", () => {
    const finding = {
      ...baseFinding,
      detections: [
        {
          method: "rule",
          ruleId: "openai-key",
          evidence: [
            { type: "text-span", start: 4, end: 20, line: 1, quote: "sk-test" },
            {
              type: "image-region",
              box: { x: 1, y: 2, w: 3, h: 4 },
              quote: null,
            },
            { type: "image-whole", note: "Tab bar shows a client name." },
            {
              type: "file-structure",
              note: "Bytes after IEND.",
              byteOffset: 1024,
            },
          ],
        },
      ],
    };

    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  test("rejects an unknown decision", () => {
    const finding = { ...baseFinding, detections: [], decision: "maybe" };

    expect(FindingSchema.safeParse(finding).success).toBe(false);
  });
});

test("FileEntrySchema parses aiAnalysis skipped-too-large", () => {
  const entry = {
    id: "file-1",
    originalName: "notes.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: 10,
    sha256: "a".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "skipped-too-large",
    excluded: false,
  };

  expect(FileEntrySchema.safeParse(entry).success).toBe(true);
});

test("SettingsResponseSchema rejects an extra apiKey field", () => {
  const response = {
    baseUrl: "http://127.0.0.1:11434/v1",
    textModel: "gemma4:e4b",
    visionModel: null,
    timeoutMs: 30000,
    provider: "openai-compatible",
    apiKeySet: true,
    apiKey: "secret-value",
  };

  expect(SettingsResponseSchema.safeParse(response).success).toBe(false);
});

test("ScanStartBodySchema defaults confirmRemote to false", () => {
  expect(ScanStartBodySchema.parse({})).toEqual({ confirmRemote: false });
});

test("image-region evidence saved without an anchor still parses, with a null anchor", () => {
  const finding = FindingSchema.parse({
    ...baseFinding,
    detections: [
      {
        method: "ocr-rule",
        ruleId: null,
        evidence: [{ type: "image-region", box: { x: 1, y: 2, w: 3, h: 4 }, quote: null }],
      },
    ],
  });

  const evidence = finding.detections[0]?.evidence[0];

  expect(evidence?.type === "image-region" ? (evidence.anchor ?? null) : "wrong type").toBeNull();
});

test("a coverage report saved without documentNotes parses with an empty list", () => {
  const report = {
    filesTotal: 0,
    filesProcessed: 0,
    filesFailed: [],
    filesUnsupported: [],
    filesExcluded: [],
    filesWithoutAi: [],
    filesLowConfidenceOcr: [],
    findingsOpen: 0,
    findingsByCategory: {},
    llmQuotesDropped: 0,
    mode: "rules-only",
    locality: "mock",
    models: { text: null, vision: null },
    modeFallback: null,
  };

  expect(CoverageReportSchema.parse(report).documentNotes).toEqual([]);
});
