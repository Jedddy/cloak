import { afterEach, describe, expect, test } from "bun:test";

import { fixtureProfiles, fixtureRecipients } from "@/lib/contract/fixtures";
import type { AiLayer, DetectLayer, EffectiveSettings, Layers } from "@/lib/contract/interfaces";
import type { FileEntry, Mode, ModeResolution } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";

import { getJob } from "./jobs";
import { analyzeFiles, startScan, type AnalysisInput } from "./pipeline";
import { addOriginal, createPackage, readFindings, readPackage, withFindingsLock, writeFindings, writeRecipients } from "./store";
import { expectApiError, withTempWorkspace } from "./testing";

const settings: EffectiveSettings = {
  baseUrl: "http://127.0.0.1:11434/v1",
  textModel: "t",
  visionModel: "v",
  timeoutMs: 1000,
  provider: "openai-compatible",
  apiKey: null,
};

type Overrides = {
  detect?: Partial<DetectLayer>;
  ai?: Partial<AiLayer>;
};

/** Stub layers that record `fileName:step` for each layer call. */
function recordingLayers(calls: string[], overrides: Overrides = {}): Layers {
  const detect: DetectLayer = {
    ...stubLayers.detect,
    structure: async (input) => {
      calls.push(`${input.fileName}:structure`);

      return [];
    },
    ocr: async (input) => {
      calls.push(`${input.fileName}:ocr`);

      return { lowConfidence: false, words: [{ text: "Hello", box: { x: 0, y: 0, w: 5, h: 5 }, confidence: 90, line: 0 }] };
    },
    rules: async (input) => {
      calls.push(`${input.fileName}:rules`);

      return [];
    },
    protectedTerms: async (input) => {
      calls.push(`${input.fileName}:protectedTerms`);

      return [];
    },
    ...overrides.detect,
  };

  const ai: AiLayer = {
    ...stubLayers.ai,
    analyzeText: async (input) => {
      calls.push(`${input.fileName}:analyzeText`);

      return { candidates: [], quotesDropped: 2, status: "done" };
    },
    analyzeVision: async (input) => {
      calls.push(`${input.fileName}:analyzeVision`);

      return { candidates: [], quotesDropped: 0, status: "done" };
    },
    ...overrides.ai,
  };

  return { detect, ai, redact: stubLayers.redact };
}

function file(name: string, kind: FileEntry["kind"]): FileEntry {
  return {
    id: `id-${name.replace(/[^a-z0-9]/gi, "")}`,
    originalName: name,
    kind,
    mime: kind === "image" ? "image/png" : "text/plain",
    sizeBytes: 5,
    sha256: "0".repeat(64),
    status: kind === "unsupported" ? "unsupported" : "pending",
    failureReason: null,
    aiAnalysis: "skipped-no-model",
    excluded: false,
  };
}

function input(layers: Layers, files: FileEntry[], mode: Mode = "full"): AnalysisInput {
  const resolution: ModeResolution = { mode, locality: "lan", models: { text: "t", vision: "v" } };

  return {
    layers,
    settings,
    resolution,
    files,
    readFile: async () => new TextEncoder().encode("hello"),
    ocrCache: { read: async () => null, write: async () => {} },
    profile: fixtureProfiles[0],
    recipient: fixtureRecipients[0],
    otherClientNames: ["Acme Corp"],
    protectedTerms: ["Juniper"],
    progress: { setFile: () => {}, setMode: () => {} },
  };
}

describe("analyzeFiles", () => {
  test("each file calls structure, OCR (images only), rules, protected terms, AI text, AI vision (images only) in order", async () => {
    const calls: string[] = [];

    await analyzeFiles(input(recordingLayers(calls), [file("a.md", "text"), file("b.png", "image"), file("c.md", "text")]));

    expect(calls).toEqual([
      "a.md:structure",
      "a.md:rules",
      "a.md:protectedTerms",
      "a.md:analyzeText",
      "b.png:structure",
      "b.png:ocr",
      "b.png:rules",
      "b.png:protectedTerms",
      "b.png:analyzeText",
      "b.png:analyzeVision",
      "c.md:structure",
      "c.md:rules",
      "c.md:protectedTerms",
      "c.md:analyzeText",
    ]);
  });

  test("when the AI fails on file 4 of 6, files 4-6 finish rules-only with aiAnalysis failed", async () => {
    const calls: string[] = [];
    const files = ["1", "2", "3", "4", "5", "6"].map((name) => file(`${name}.md`, "text"));

    const layers = recordingLayers(calls, {
      ai: {
        analyzeText: async (request) => {
          calls.push(`${request.fileName}:analyzeText`);

          if (request.fileName === "4.md") {
            throw new Error("connect ECONNREFUSED");
          }

          return { candidates: [], quotesDropped: 0, status: "done" };
        },
      },
    });

    const result = await analyzeFiles(input(layers, files));

    expect(result.files.map((entry) => entry.aiAnalysis)).toEqual(["done", "done", "done", "failed", "failed", "failed"]);
    expect(result.files.every((entry) => entry.status === "processed")).toBe(true);
    expect(result.mode).toBe("rules-only");
    expect(result.modeFallback).toEqual({ from: "full", atFileId: "id-4md", reason: "The model stopped answering." });
    expect(calls).not.toContain("5.md:analyzeText");
    expect(calls).toContain("6.md:rules");
  });

  test("text-ai mode never calls AI vision", async () => {
    const calls: string[] = [];

    await analyzeFiles(input(recordingLayers(calls), [file("b.png", "image")], "text-ai"));

    expect(calls).toContain("b.png:analyzeText");
    expect(calls).not.toContain("b.png:analyzeVision");
  });

  test("rules-only mode calls no AI function and marks each file skipped-no-model", async () => {
    const calls: string[] = [];
    const result = await analyzeFiles(input(recordingLayers(calls), [file("a.md", "text"), file("b.png", "image")], "rules-only"));

    expect(calls.some((call) => call.includes(":analyze"))).toBe(false);
    expect(result.files.map((entry) => entry.aiAnalysis)).toEqual(["skipped-no-model", "skipped-no-model"]);
  });

  test("an unsupported file calls no layer and stays unsupported", async () => {
    const calls: string[] = [];
    const result = await analyzeFiles(input(recordingLayers(calls), [file("x.pdf", "unsupported")]));

    expect(calls).toEqual([]);
    expect(result.files[0]?.status).toBe("unsupported");
  });

  test("a file whose OCR throws is failed with its reason and the other files finish", async () => {
    const calls: string[] = [];

    const layers = recordingLayers(calls, {
      detect: {
        ocr: async () => {
          throw new Error("The image data cannot be read.");
        },
      },
    });

    const result = await analyzeFiles(input(layers, [file("broken.png", "image"), file("a.md", "text")]));

    expect(result.files[0]?.status).toBe("failed");
    expect(result.files[0]?.failureReason).toBe("The image data cannot be read.");
    expect(result.files[1]?.status).toBe("processed");
  });

  test("quotes dropped by the AI layer are summed", async () => {
    const result = await analyzeFiles(input(recordingLayers([]), [file("a.md", "text"), file("c.md", "text")]));

    expect(result.quotesDropped).toBe(4);
  });
});

describe("startScan", () => {
  // process.env types NODE_ENV as read-only; tests need to set it.
  const env: Record<string, string | undefined> = process.env;

  withTempWorkspace();

  afterEach(() => {
    delete process.env.SENTINEL_ALLOW_REMOTE;
    env.NODE_ENV = "test";
  });

  async function demoPackage() {
    await writeRecipients(fixtureRecipients);

    const pkg = await createPackage({ name: "Handoff", recipientId: "recipient-northwind", protectedTerms: ["Juniper"] });

    await addOriginal(pkg.id, { name: ".env.example", bytes: new TextEncoder().encode("OPENAI_API_KEY=sk-fixture\n") });
    await addOriginal(pkg.id, { name: "spec.md", bytes: new TextEncoder().encode("# Spec\n") });

    return pkg;
  }

  async function finished(jobId: string) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const status = getJob(jobId)?.status;

      if (status === "done" || status === "failed") {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return "timeout";
  }

  function remoteLayers(): Layers {
    return {
      ...stubLayers,
      ai: {
        ...stubLayers.ai,
        resolveMode: async () => ({ mode: "rules-only", locality: "remote", models: { text: null, vision: null } }),
      },
    };
  }

  test("remote locality without confirmation is rejected", async () => {
    const pkg = await demoPackage();

    await expectApiError(startScan(pkg.id, { confirmRemote: false }, remoteLayers()), "remote-not-confirmed");
  });

  test("remote locality with the dev flag in development proceeds", async () => {
    const pkg = await demoPackage();

    process.env.SENTINEL_ALLOW_REMOTE = "true";
    env.NODE_ENV = "development";

    const job = await startScan(pkg.id, { confirmRemote: false }, remoteLayers());

    expect(await finished(job.id)).toBe("done");
  });

  test("a stub-layer scan writes findings and coverage, and a rescan keeps a decision", async () => {
    const pkg = await demoPackage();
    const first = await startScan(pkg.id, { confirmRemote: false }, stubLayers);

    expect(await finished(first.id)).toBe("done");

    const findings = await readFindings(pkg.id);
    const secret = findings.find((finding) => finding.category === "secret");
    const scanned = await readPackage(pkg.id);

    expect(secret?.decision).toBe("open");
    expect(scanned.status).toBe("scanned");
    expect(scanned.lastScan?.mode).toBe("full");
    expect(scanned.files.every((entry) => entry.status === "processed")).toBe(true);

    await withFindingsLock(pkg.id, () =>
      writeFindings(pkg.id, findings.map((finding) => (finding.id === secret?.id ? { ...finding, decision: "keep" } : finding))),
    );

    const second = await startScan(pkg.id, { confirmRemote: false }, stubLayers);

    expect(await finished(second.id)).toBe("done");
    expect((await readFindings(pkg.id)).find((finding) => finding.id === secret?.id)?.decision).toBe("keep");
  });
});
