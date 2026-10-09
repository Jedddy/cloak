import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type {
  AiLayer,
  AiAnalysisResult,
  ConnectionInput,
  TextAnalysisInput,
} from "@/lib/contract/interfaces";
import type { Evidence, FindingCandidate, ModeResolution, OcrWord } from "@/lib/contract/schemas";
import { classifyLocality } from "./locality";
import { listModels, validatedCompletion, type Message } from "./client";
import { mockFindings } from "./mock";
import {
  analysisMessages,
  MAX_TEXT_BYTES,
  textChunks,
  textResponse,
  visionResponse,
  type ModelFinding,
} from "./prompts";
import { matchQuote } from "./quotes";

const probeSchema = z.strictObject({ ok: z.literal(true) });

const probeImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC";

async function connection(input: ConnectionInput) {
  const { settings } = input;
  const locality = classifyLocality(input);

  if (settings.provider === "mock") {
    return {
      resolution: {
        mode: "full",
        locality,
        models: { text: "mock-text", vision: "mock-vision" },
      } satisfies ModeResolution,
      models: ["mock-text", "mock-vision"],
      jsonOk: true,
      error: null,
    };
  }

  const shortSettings = { ...settings, timeoutMs: Math.min(settings.timeoutMs, 3000) };
  let models: string[];

  try {
    models = await listModels(shortSettings);
  } catch {
    return {
      resolution: {
        mode: "rules-only",
        locality,
        models: { text: null, vision: null },
      } satisfies ModeResolution,
      models: [],
      jsonOk: false,
      error: "Model server is unavailable.",
    };
  }

  const available = { text: false, vision: false };

  for (const kind of ["text", "vision"] as const) {
    const model = kind === "text" ? settings.textModel : settings.visionModel;

    if (model === null || !models.includes(model)) continue;

    const messages: Message[] = [
      { role: "system", content: 'Return JSON only: {"ok":true}.' },
      { role: "user", content: "Connection test." },
    ];

    if (kind === "vision")
      messages[1].content = [
        {
          type: "text",
          text: 'Confirm that you can receive this image. Return JSON only: {"ok":true}.',
        },
        { type: "image_url", image_url: { url: probeImage } },
      ];

    try {
      available[kind] =
        (await validatedCompletion({
          settings: shortSettings,
          model,
          messages,
          schema: probeSchema,
          contentHash: null,
        })) !== null;
    } catch {
      /* A failed capability probe narrows the mode. */
    }
  }

  let mode: ModeResolution["mode"] = "rules-only";

  if (available.text) mode = available.vision ? "full" : "text-ai";

  return {
    resolution: {
      mode,
      locality,
      models: {
        text: available.text ? settings.textModel : null,
        vision: mode === "full" ? settings.visionModel : null,
      },
    } satisfies ModeResolution,
    models,
    jsonOk: available.text,
    error: available.text ? null : "The configured text model did not pass its JSON test.",
  };
}

type CandidateInput = {
  findings: ModelFinding[];
  fileId: string;
  text: string;
  words: OcrWord[] | null;
  method: "llm-text" | "llm-vision";
  related: boolean;
  start: number;
  startLine: number;
};

function groundFindings(input: CandidateInput): AiAnalysisResult {
  const candidates: FindingCandidate[] = [];
  let quotesDropped = 0;

  for (const finding of input.findings) {
    let evidence: Evidence[] = [];

    if (finding.quote !== null) evidence = matchQuote(finding.quote, input.text, input.words);

    if (evidence.length === 0) {
      if (input.method === "llm-text") {
        quotesDropped++;
        continue;
      }

      let region = "visible region";

      if ("regionType" in finding) region = finding.regionType;
      evidence = [
        {
          type: "image-whole",
          note: `Inspect ${region} and draw a box before redacting. ${finding.reason}`,
        },
      ];
    }

    evidence = evidence.map((entry) => {
      if (entry.type !== "text-span") return entry;

      return {
        ...entry,
        start: entry.start + input.start,
        end: entry.end + input.start,
        line: entry.line + input.startLine,
      };
    });

    let title = finding.category.replaceAll("-", " ");

    if (input.related) title = "Possible related (AI suggestion)";
    candidates.push({
      fileId: input.fileId,
      category: finding.category,
      detections: [{ method: input.method, ruleId: null, evidence }],
      title,
      reason: finding.reason,
      relatedGroupId: null,
    });
  }

  return { candidates, quotesDropped, status: "done" };
}

function mergeCandidates(candidates: FindingCandidate[]): FindingCandidate[] {
  const merged: FindingCandidate[] = [];
  const matchingKeys = new Map<FindingCandidate, Set<string>>();

  for (const candidate of candidates) {
    const keys = new Set(
      candidate.detections[0].evidence.map((entry) => {
        if (entry.type === "text-span")
          return `text:${entry.quote.toLowerCase().replace(/\s+/g, " ")}`;

        return JSON.stringify(entry);
      }),
    );

    const existing = merged.find(
      (entry) =>
        entry.fileId === candidate.fileId &&
        entry.category === candidate.category &&
        entry.title === candidate.title &&
        [...keys].some((key) => matchingKeys.get(entry)?.has(key)),
    );

    if (existing === undefined) {
      merged.push(candidate);
      matchingKeys.set(candidate, keys);
      continue;
    }

    const evidence = existing.detections[0].evidence;
    const seen = new Set(evidence.map((entry) => JSON.stringify(entry)));

    for (const key of keys) matchingKeys.get(existing)?.add(key);

    for (const entry of candidate.detections[0].evidence) {
      const key = JSON.stringify(entry);

      if (!seen.has(key)) {
        evidence.push(entry);
        seen.add(key);
      }
    }
  }

  return merged;
}

async function analyzeText(
  input: TextAnalysisInput,
  relatedTerm: string | null = null,
): Promise<AiAnalysisResult> {
  if (Buffer.byteLength(input.text, "utf8") > MAX_TEXT_BYTES)
    return { candidates: [], quotesDropped: 0, status: "skipped-too-large" };
  const candidates: FindingCandidate[] = [];
  let quotesDropped = 0;
  let status: AiAnalysisResult["status"] = "done";

  for (const chunk of textChunks(input.text)) {
    let findings: ModelFinding[];

    if (input.settings.provider === "mock") {
      findings = mockFindings(chunk.text, relatedTerm);
    } else {
      if (input.settings.textModel === null)
        throw new Error("Model request failed: no text model configured.");

      const messages = analysisMessages({
        ...input,
        text: chunk.text,
        startLine: chunk.startLine,
        relatedTerm,
        vision: false,
      });

      const response = await validatedCompletion({
        settings: input.settings,
        model: input.settings.textModel,
        messages,
        schema: textResponse,
        contentHash: input.contentSha256,
      });

      if (response === null) {
        status = "failed";
        continue;
      }

      findings = response.findings;
    }

    const result = groundFindings({
      findings,
      fileId: input.fileId,
      text: chunk.text,
      words: input.ocrWords,
      method: "llm-text",
      related: relatedTerm !== null,
      start: chunk.start,
      startLine: chunk.startLine,
    });

    candidates.push(...result.candidates);
    quotesDropped += result.quotesDropped;
  }

  return { candidates: mergeCandidates(candidates), quotesDropped, status };
}

export const aiLayer: AiLayer = {
  classifyLocality,
  resolveMode: async (input) => (await connection(input)).resolution,
  testConnection: async (input) => {
    const start = performance.now();
    const tested = await connection(input);

    return {
      ok: tested.jsonOk,
      models: tested.models,
      jsonTest: { ok: tested.jsonOk, error: tested.error },
      latencyMs: performance.now() - start,
      locality: tested.resolution.locality,
      mode: tested.resolution.mode,
      error: tested.error,
    };
  },
  analyzeText,
  analyzeVision: async (input) => {
    const text = input.ocrWords.map((word) => word.text).join(" ");
    let findings: ModelFinding[];

    if (input.settings.provider === "mock") {
      findings = mockFindings(text);
    } else {
      if (input.settings.visionModel === null || input.settings.textModel === null)
        throw new Error("Model request failed: full mode requires text and vision models.");

      const bytes = await sharp(input.imageBytes)
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();

      const prompt = analysisMessages({
        ...input,
        text,
        startLine: 0,
        relatedTerm: null,
        vision: true,
      });

      const messages: Message[] = [
        prompt[0],
        {
          role: "user",
          content: [
            { type: "text", text: prompt[1].content },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` },
            },
          ],
        },
      ];

      const response = await validatedCompletion({
        settings: input.settings,
        model: input.settings.visionModel,
        messages,
        schema: visionResponse,
        contentHash: input.contentSha256,
      });

      if (response === null) return { candidates: [], quotesDropped: 0, status: "failed" };
      findings = response.findings;
    }

    return groundFindings({
      findings,
      fileId: input.fileId,
      text,
      words: input.ocrWords,
      method: "llm-vision",
      related: false,
      start: 0,
      startLine: 0,
    });
  },
  findRelatedSuggestions: async (input) => {
    if (input.settings.provider !== "mock" && input.settings.textModel === null) return [];
    const candidates: FindingCandidate[] = [];

    for (const source of input.sources) {
      const result = await analyzeText(
        {
          ...source,
          settings: input.settings,
          contentSha256: createHash("sha256").update(source.text).digest("hex"),
          recipientName: "",
          profile: {
            id: "related",
            name: "Related references",
            description: "Suggestions for human review.",
            allowed: [],
            remove: [],
            needsDecision: [],
          },
          protectedTerms: [input.term],
        },
        input.term,
      );

      candidates.push(...result.candidates);
    }

    return candidates;
  },
};
