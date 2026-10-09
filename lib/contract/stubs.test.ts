import { expect, test } from "bun:test";

import {
  fixtureConnectionTest,
  fixtureCoverage,
  fixtureFindings,
  fixtureJob,
  fixtureModeResolution,
  fixtureOcrScreenshot01,
  fixturePackageDetail,
  fixtureProfiles,
  fixtureRecipients,
  fixtureRelatedResult,
  fixtureSettingsResponse,
  fixtureVerification,
  fixtureWarnings,
} from "./fixtures";
import type { Layers } from "./interfaces";
import {
  ConnectionTestResultSchema,
  CoverageReportSchema,
  FindingSchema,
  JobSchema,
  ModeResolutionSchema,
  OcrResultSchema,
  PackageDetailSchema,
  PackageWarningSchema,
  RecipientProfileSchema,
  RecipientSchema,
  RelatedResultSchema,
  SettingsResponseSchema,
  VerificationResultSchema,
} from "./schemas";
import { stubLayers } from "./stubs";

test("every fixture parses with its schema", () => {
  const checks = [
    () => fixtureProfiles.map((item) => RecipientProfileSchema.parse(item)),
    () => fixtureRecipients.map((item) => RecipientSchema.parse(item)),
    () => fixtureFindings.map((item) => FindingSchema.parse(item)),
    () => fixtureWarnings.map((item) => PackageWarningSchema.parse(item)),
    () => CoverageReportSchema.parse(fixtureCoverage),
    () => JobSchema.parse(fixtureJob),
    () => VerificationResultSchema.parse(fixtureVerification),
    () => PackageDetailSchema.parse(fixturePackageDetail),
    () => RelatedResultSchema.parse(fixtureRelatedResult),
    () => SettingsResponseSchema.parse(fixtureSettingsResponse),
    () => ModeResolutionSchema.parse(fixtureModeResolution),
    () => ConnectionTestResultSchema.parse(fixtureConnectionTest),
    () => OcrResultSchema.parse(fixtureOcrScreenshot01),
  ];

  for (const check of checks) {
    expect(check).not.toThrow();
  }
});

test("the fixtures cover every detection method", () => {
  const methods = new Set(
    fixtureFindings.flatMap((finding) =>
      finding.detections.map((detection) => detection.method),
    ),
  );

  expect([...methods].sort()).toEqual([
    "llm-text",
    "llm-vision",
    "manual",
    "ocr-rule",
    "protected-term",
    "rule",
    "structure",
  ]);
});

test("stub detect.rules returns the .env.example secret for that file name", async () => {
  const layers: Layers = stubLayers;

  const candidates = await layers.detect.rules({
    fileId: "uploaded-id",
    fileName: ".env.example",
    text: "OPENAI_API_KEY=sk-fixture",
    ocrWords: null,
  });

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.category).toBe("secret");
  expect(candidates[0]?.fileId).toBe("uploaded-id");
});

test("stub ai.resolveMode returns mode full and locality mock", async () => {
  const resolution = await stubLayers.ai.resolveMode({
    settings: {
      baseUrl: "http://127.0.0.1:11434/v1",
      textModel: null,
      visionModel: null,
      timeoutMs: 1000,
      provider: "mock",
      apiKey: null,
    },
  });

  expect(resolution.mode).toBe("full");
  expect(resolution.locality).toBe("mock");
});
