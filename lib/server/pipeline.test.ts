import { afterEach, describe, expect, test } from "bun:test";

import { fixtureProfiles, fixtureRecipients } from "@/lib/contract/fixtures";
import type { AiLayer, DetectLayer, EffectiveSettings, Layers } from "@/lib/contract/interfaces";
import { DOCUMENT_MIMES, type DocumentFormat, type DocumentModel, type FileEntry, type Mode, type ModeResolution, type OcrResult, type RecipientProfile } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";
import { detectLayer } from "@/lib/detect";
import { documentLayer } from "@/lib/document";
import { buildDocx, buildPptx, buildXlsx } from "@/lib/document/fixtures/ooxml";
import { buildPdf } from "@/lib/document/fixtures/pdf";

import { analyzeFiles, startScan, type AnalysisInput } from "./pipeline";
import { addOriginal, createPackage, readFindings, readPackage, withFindingsLock, writeFindings, writeRecipients } from "./store";
import { expectApiError, waitForJob, withTempWorkspace } from "./testing";

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

  return { detect, ai, redact: stubLayers.redact, document: stubLayers.document };
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

describe("analyzeFiles with documents", () => {
  const secretWord = { text: "sk_live_4eC39HqLyjWDarjtT1zdp7dc", box: { x: 1, y: 1, w: 90, h: 10 }, confidence: 95, line: 0 };

  function documentEntry(name: string, format: DocumentFormat): FileEntry {
    return { ...file(name, "document"), mime: DOCUMENT_MIMES[format] };
  }

  /** Real document and detect layers; the model calls and OCR are recorded stubs. */
  function realLayers(calls: string[], overrides: Overrides = {}): Layers {
    const recording = recordingLayers(calls, overrides);

    return {
      ...recording,
      detect: { ...detectLayer, ocr: recording.detect.ocr },
      document: documentLayer,
    };
  }

  function documentInput(layers: Layers, files: FileEntry[], bytes: Record<string, Uint8Array>, mode: Mode = "rules-only") {
    return {
      ...input(layers, files, mode),
      readFile: async (entry: FileEntry) => bytes[entry.originalName] ?? new Uint8Array(),
    };
  }

  test("a protected term in a DOCX table cell is found with offsets into the model text", async () => {
    const cached: DocumentModel[] = [];
    const bytes = await buildDocx({ table: [["Client", "Acme Corp"]] });
    const entry = documentEntry("a.docx", "docx");

    const result = await analyzeFiles({
      ...documentInput(realLayers([]), [entry], { "a.docx": bytes }),
      protectedTerms: ["Acme"],
      otherClientNames: [],
      documentCache: { write: async (_id, written) => void cached.push(written) },
    });

    const span = result.candidates
      .flatMap((candidate) => candidate.detections.flatMap((detection) => detection.evidence))
      .find((evidence) => evidence.type === "text-span" && evidence.quote.includes("Acme"));

    expect(span?.type).toBe("text-span");

    if (span?.type !== "text-span") {
      throw new Error("expected a text span");
    }

    expect(cached[0]?.text.slice(span.start, span.end)).toBe(span.quote);
  });

  test("OCR of an embedded image is cached per image and its secret lies in the OCR section", async () => {
    const written: Record<string, OcrResult> = {};
    const cached: DocumentModel[] = [];
    const entry = documentEntry("b.docx", "docx");

    const layers = realLayers([], {
      detect: { ocr: async () => ({ lowConfidence: false, words: [secretWord] }) },
    });

    const result = await analyzeFiles({
      ...documentInput(layers, [entry], { "b.docx": await buildDocx({ paragraphs: ["Body"], image: true }) }),
      ocrCache: { read: async () => null, write: async (id, ocr) => void (written[id] = ocr) },
      documentCache: { write: async (_id, model) => void cached.push(model) },
    });

    expect(Object.keys(written)).toEqual([`${entry.id}-i0`]);

    const model = cached[0];
    const secret = result.candidates.find((candidate) => candidate.category === "secret");
    const span = secret?.detections[0]?.evidence[0];

    expect(model?.text).toContain(secretWord.text);
    expect(span?.type).toBe("text-span");

    if (span?.type !== "text-span" || model === undefined) {
      throw new Error("expected a text span");
    }

    const section = model.sections.find((candidate) => candidate.title.startsWith("Image"));

    expect(section?.items.some((item) => item.start <= span.start && span.end <= item.end)).toBe(true);
    expect(model.text.slice(span.start, span.end)).toBe(span.quote);
  });

  test("AE4: a tracked change becomes a redact finding with a hidden anchor even when the profile asks for a decision", async () => {
    const entry = documentEntry("c.docx", "docx");
    const bytes = await buildDocx({ paragraphs: ["Body"], insertions: [{ id: 1, author: "J. Cruz", text: "Added" }] });
    const profile: RecipientProfile = { ...fixtureProfiles[0], remove: [], needsDecision: ["hidden-data", "metadata"] };

    const result = await analyzeFiles({ ...documentInput(realLayers([]), [entry], { "c.docx": bytes }), profile });
    const revision = result.candidates.find((candidate) => candidate.detections.some((detection) => detection.ruleId === "document-revision"));
    const evidence = revision?.detections[0]?.evidence[0];

    expect(revision?.category).toBe("hidden-data");
    expect(revision?.suggestedAction).toBe("redact");
    expect(evidence?.type === "file-structure" && evidence.anchor?.startsWith("hidden:")).toBe(true);
  });

  test("a SmartArt part is a not-analysed note and not a finding", async () => {
    const entry = documentEntry("d.docx", "docx");
    const bytes = await buildDocx({ paragraphs: ["Body"], smartArt: true });
    const result = await analyzeFiles(documentInput(realLayers([]), [entry], { "d.docx": bytes }));

    expect(result.documentNotes.filter((note) => note.kind === "not-analysed" && note.fileId === entry.id)).toHaveLength(1);
    expect(result.candidates.some((candidate) => candidate.title.toLowerCase().includes("smartart"))).toBe(false);
  });

  test("rules-only on a PDF finds secrets, calls no AI, and marks the file skipped-no-model", async () => {
    const calls: string[] = [];
    const entry = documentEntry("e.pdf", "pdf");
    const bytes = buildPdf({ pages: [{ lines: [`key ${secretWord.text}`] }] });
    const result = await analyzeFiles(documentInput(realLayers(calls), [entry], { "e.pdf": bytes }));

    expect(result.candidates.some((candidate) => candidate.category === "secret")).toBe(true);
    expect(result.files[0]?.aiAnalysis).toBe("skipped-no-model");
    expect(calls.filter((call) => call.includes("analyze"))).toEqual([]);
  });

  test("when the model fails on the second document, later files are rules-only and the fallback names it", async () => {
    const files = ["1", "2", "3"].map((name) => documentEntry(`${name}.docx`, "docx"));
    const docx = await buildDocx({ paragraphs: ["Body"] });

    const layers = realLayers([], {
      ai: {
        analyzeText: async (request) => {
          if (request.fileName === "2.docx") {
            throw new Error("connect ECONNREFUSED");
          }

          return { candidates: [], quotesDropped: 0, status: "done" };
        },
      },
    });

    const result = await analyzeFiles(
      documentInput(layers, files, { "1.docx": docx, "2.docx": docx, "3.docx": docx }, "text-ai"),
    );

    expect(result.files.map((entry) => entry.aiAnalysis)).toEqual(["done", "failed", "failed"]);
    expect(result.modeFallback?.atFileId).toBe(files[1]?.id);
    expect(result.mode).toBe("rules-only");
  });

  test("F1: one file of each format ends processed, and Text AI never calls vision", async () => {
    const calls: string[] = [];
    const formats: DocumentFormat[] = ["pdf", "docx", "xlsx", "pptx"];
    const files = formats.map((format) => documentEntry(`f.${format}`, format));

    const bytes = {
      "f.pdf": buildPdf({ pages: [{ lines: ["Page one"], image: true }] }),
      "f.docx": await buildDocx({ paragraphs: ["Body"], image: true }),
      "f.xlsx": await buildXlsx({ sheets: [{ name: "Sheet1", cells: { A1: { text: "Cell" } } }] }),
      "f.pptx": await buildPptx({ slides: [{ texts: ["Slide"] }] }),
    };

    const result = await analyzeFiles(documentInput(realLayers(calls), files, bytes, "text-ai"));

    expect(result.files.map((entry) => entry.status)).toEqual(["processed", "processed", "processed", "processed"]);
    expect(result.files.map((entry) => entry.aiAnalysis)).toEqual(["done", "done", "done", "done"]);
    expect(calls.some((call) => call.endsWith(":analyzeVision"))).toBe(false);
  });

  test("Full mode runs vision per image and anchors its evidence to the image", async () => {
    const entry = documentEntry("g.docx", "docx");
    const seen: number[] = [];

    const layers = realLayers([], {
      detect: { ocr: async () => ({ lowConfidence: false, words: [secretWord] }) },
      ai: {
        analyzeVision: async (request) => {
          seen.push(request.ocrWords.length);

          return {
            candidates: [
              {
                fileId: request.fileId,
                category: "other",
                detections: [
                  {
                    method: "llm-vision",
                    ruleId: null,
                    evidence: [{ type: "image-region", box: { x: 0, y: 0, w: 5, h: 5 }, quote: null }],
                  },
                ],
                title: "Logo",
                reason: "r",
                relatedGroupId: null,
              },
            ],
            quotesDropped: 0,
            status: "done",
          };
        },
      },
    });

    const result = await analyzeFiles(documentInput(layers, [entry], { "g.docx": await buildDocx({ image: true }) }, "full"));
    const region = result.candidates.find((candidate) => candidate.title === "Logo")?.detections[0]?.evidence[0];

    expect(seen).toEqual([1]);
    expect(region?.type === "image-region" && region.anchor).toBe("image:word/media/image1.png");
  });

  test("documentCache.write receives the model with the OCR text appended", async () => {
    const entry = documentEntry("h.docx", "docx");
    const models: DocumentModel[] = [];
    const layers = realLayers([], { detect: { ocr: async () => ({ lowConfidence: false, words: [secretWord] }) } });

    await analyzeFiles({
      ...documentInput(layers, [entry], { "h.docx": await buildDocx({ paragraphs: ["Body"], image: true }) }),
      documentCache: { write: async (id, model) => void models.push({ ...model, text: `${id}|${model.text}` }) },
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.text).toContain(`${entry.id}|Body`);
    expect(models[0]?.text).toContain(secretWord.text);
    expect(models[0]?.words.some((word) => word.text === secretWord.text)).toBe(true);
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

    expect(await waitForJob(job.id)).toBe("done");
  });

  test("a stub-layer scan writes findings and coverage, and a rescan keeps a decision", async () => {
    const pkg = await demoPackage();
    const first = await startScan(pkg.id, { confirmRemote: false }, stubLayers);

    expect(await waitForJob(first.id)).toBe("done");

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

    expect(await waitForJob(second.id)).toBe("done");
    expect((await readFindings(pkg.id)).find((finding) => finding.id === secret?.id)?.decision).toBe("keep");
  });
});
