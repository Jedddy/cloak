import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { aiLayer } from "@/lib/ai";
import { readAiMetrics } from "@/lib/ai/client";
import { scoreFindings } from "@/lib/ai/evaluation";
import { fixtureProfiles, fixtureRecipients } from "@/lib/contract/fixtures";
import type { EffectiveSettings, Layers } from "@/lib/contract/interfaces";
import {
  BoxSchema,
  CategorySchema,
  ModeSchema,
  OcrWordSchema,
  ProviderSchema,
  type FileEntry,
  type Mode,
  type ModeResolution,
} from "@/lib/contract/schemas";
import { layers } from "@/lib/server/layers";
import { analyzeFiles } from "@/lib/server/pipeline";
import { readEffectiveSettings } from "@/lib/server/settings";
import { sha256 } from "@/lib/server/store";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "mock" },
    mode: { type: "string", default: "all" },
    "base-url": { type: "string" },
    "text-model": { type: "string" },
    "vision-model": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

// Keep the pipeline's count-only diagnostics outside the JSON document.
if (values.json) console.info = console.error;

const provider = ProviderSchema.parse(values.provider);

const modes: Mode[] =
  values.mode === "all" ? ["rules-only", "text-ai", "full"] : [ModeSchema.parse(values.mode)];

const effective = await readEffectiveSettings();

const settings: EffectiveSettings = {
  ...effective,
  provider,
  baseUrl: values["base-url"] ?? effective.baseUrl,
  textModel: values["text-model"] ?? effective.textModel,
  visionModel: values["vision-model"] ?? effective.visionModel,
};

const root = new URL("../fixtures/eval/", import.meta.url);

const manifestSchema = z.object({
  files: z
    .array(
      z.object({
        file: z.string().regex(/^[a-zA-Z0-9._-]+$/),
        ocrWords: z.array(OcrWordSchema).optional(),
      }),
    )
    .min(10)
    .max(20),
  labels: z.array(
    z.object({
      file: z.string(),
      category: CategorySchema,
      quote: z.string().optional(),
      box: BoxSchema.optional(),
    }),
  ),
});

const manifest = manifestSchema.parse(
  JSON.parse(await readFile(new URL("labels.json", root), "utf8")),
);

const bytes = new Map<string, Uint8Array>();

const files: FileEntry[] = [];

for (const entry of manifest.files) {
  const content = await readFile(new URL(entry.file, root));
  bytes.set(entry.file, content);
  const image = entry.file.endsWith(".png");
  files.push({
    id: entry.file,
    originalName: entry.file,
    kind: image ? "image" : "text",
    mime: image ? "image/png" : "text/markdown",
    sizeBytes: content.byteLength,
    sha256: sha256(content),
    status: "pending",
    failureReason: null,
    aiAnalysis: "skipped-no-model",
    excluded: false,
  });
}

const runs = [];

for (const requestedMode of modes) {
  const runSettings = { ...settings };

  if (requestedMode === "text-ai") runSettings.visionModel = null;

  let resolution: ModeResolution = {
    mode: "rules-only",
    locality: aiLayer.classifyLocality({ settings: runSettings }),
    models: { text: null, vision: null },
  };

  if (requestedMode !== "rules-only") {
    resolution = await aiLayer.resolveMode({ settings: runSettings });

    if (requestedMode === "text-ai" && resolution.mode === "full")
      resolution = {
        ...resolution,
        mode: "text-ai",
        models: { ...resolution.models, vision: null },
      };
  }

  const timing = new Map<string, { started: number; durationMs: number }>();
  const perFile = new Map<string, { jsonFailures: number; before: number }>();

  const evalLayers: Layers = {
    ...layers,
    ai: aiLayer,
    detect: {
      ...layers.detect,
      ocr: async (input) => ({
        words: manifest.files.find((file) => file.file === input.fileName)?.ocrWords ?? [],
        lowConfidence: false,
      }),
    },
  };

  const before = readAiMetrics();

  const analysis = await analyzeFiles({
    layers: evalLayers,
    settings: runSettings,
    resolution,
    files,
    readFile: async (file) => {
      const content = bytes.get(file.id);

      if (content === undefined) throw new Error("Evaluation fixture missing.");

      return content;
    },
    ocrCache: { read: async () => null, write: async () => {} },
    profile: fixtureProfiles[0],
    recipient: fixtureRecipients[0],
    otherClientNames: ["Acme Corp"],
    protectedTerms: ["Juniper"],
    progress: {
      setMode: () => {},
      setFile: (fileId, status) => {
        if (status === "reading") {
          timing.set(fileId, { started: performance.now(), durationMs: 0 });
          perFile.set(fileId, { before: readAiMetrics().jsonFailures, jsonFailures: 0 });
        }

        if (status === "done" || status === "failed") {
          const time = timing.get(fileId);
          const counts = perFile.get(fileId);

          if (time !== undefined) time.durationMs = performance.now() - time.started;

          if (counts !== undefined)
            counts.jsonFailures = readAiMetrics().jsonFailures - counts.before;
        }
      },
    },
  });

  runs.push({
    requestedMode,
    actualMode: analysis.mode,
    models: resolution.models,
    quotesDropped: analysis.quotesDropped,
    jsonFailures: readAiMetrics().jsonFailures - before.jsonFailures,
    scores: scoreFindings(analysis.candidates, manifest.labels),
    files: analysis.files.map((file) => ({
      fileId: file.id,
      status: file.status,
      aiAnalysis: file.aiAnalysis,
      durationMs: Math.round(timing.get(file.id)?.durationMs ?? 0),
      jsonFailures: perFile.get(file.id)?.jsonFailures ?? 0,
    })),
  });
}

const report = {
  fixtureRoot: fileURLToPath(root),
  provider,
  deterministicLayers: "Configured server layers: the real detection and redaction layers.",
  ocr: "Fixed fixture OCR words to isolate model evaluation.",
  runs,
};

if (values.json) console.log(JSON.stringify(report));
else {
  console.log(
    `Provider: ${provider}. OCR uses fixed fixture words. Deterministic scores use the real detection and redaction layers.`,
  );

  for (const run of runs) {
    console.log(
      `${run.requestedMode} -> ${run.actualMode}; text=${run.models.text ?? "none"}; vision=${run.models.vision ?? "none"}; dropped quotes=${run.quotesDropped}; JSON failures=${run.jsonFailures}`,
    );
    console.table(run.scores);
    console.table(run.files);
  }
}

if (
  runs.some(
    (run) =>
      run.actualMode !== run.requestedMode ||
      run.files.some((file) => file.status === "failed" || file.aiAnalysis === "failed"),
  )
)
  process.exitCode = 1;
