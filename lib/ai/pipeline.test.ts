import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fixtureProfiles, fixtureRecipients } from "@/lib/contract/fixtures";
import { stubLayers } from "@/lib/contract/stubs";
import type { EffectiveSettings } from "@/lib/contract/interfaces";
import type { FileEntry } from "@/lib/contract/schemas";
import { analyzeFiles } from "@/lib/server/pipeline";
import { aiLayer } from "./index";

test("the real AI layer adds grounded findings without removing deterministic findings", async () => {
  const content = new TextEncoder().encode("Project Juniper\nOur day rate for Acme is 1,450 EUR");

  const file: FileEntry = {
    id: "notes",
    originalName: "notes.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    status: "pending",
    failureReason: null,
    aiAnalysis: "skipped-no-model",
    excluded: false,
  };

  const settings: EffectiveSettings = {
    provider: "mock",
    baseUrl: "unused",
    apiKey: null,
    textModel: null,
    visionModel: null,
    timeoutMs: 1000,
  };

  const result = await analyzeFiles({
    layers: { ...stubLayers, ai: aiLayer },
    settings,
    resolution: await aiLayer.resolveMode({ settings }),
    files: [file],
    readFile: async () => content,
    ocrCache: { read: async () => null, write: async () => {} },
    profile: fixtureProfiles[0],
    recipient: fixtureRecipients[0],
    otherClientNames: ["Acme Corp"],
    protectedTerms: ["Juniper"],
    progress: { setFile: () => {}, setMode: () => {} },
  });

  expect(result.files[0].aiAnalysis).toBe("done");
  expect(
    result.candidates.some((candidate) =>
      candidate.detections.some((detection) => detection.method === "protected-term"),
    ),
  ).toBe(true);
  expect(
    result.candidates.some(
      (candidate) =>
        candidate.category === "internal-pricing" &&
        candidate.detections.some((detection) => detection.method === "llm-text"),
    ),
  ).toBe(true);
  expect(result.quotesDropped).toBe(0);
});
