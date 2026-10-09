import { ApiError } from "@/lib/contract/errors";
import type { AiAnalysisResult, EffectiveSettings, Layers } from "@/lib/contract/interfaces";
import type {
  AiAnalysis,
  CoverageReport,
  FileEntry,
  FindingCandidate,
  Job,
  Mode,
  ModeResolution,
  OcrResult,
  OcrWord,
  ProfiledCandidate,
  Recipient,
  RecipientProfile,
  ScanStartBody,
} from "@/lib/contract/schemas";

import { carryDecisions } from "./carry";
import { buildCoverage } from "./coverage";
import { liveJob, startJob, type JobProgress } from "./jobs";
import { logEvent } from "./log";
import { readCurrentPackage, statusBeforeJob } from "./packages";
import { readEffectiveSettings } from "./settings";
import {
  readFindings,
  readOcr,
  readOriginal,
  readPackage,
  readProfiles,
  readRecipients,
  sha256,
  updatePackage,
  withFindingsLock,
  writeCoverage,
  writeFindings,
  writeOcr,
} from "./store";

// The scan pipeline (R12-R16). It calls the layers only through the
// injected Layers bundle (KTD2) and runs files one at a time; inside a
// file, structure checks run next to OCR, and rules next to protected
// terms. AI steps run one at a time (KTD11).

export type OcrCache = {
  read: (fileId: string) => Promise<OcrResult | null>;
  write: (fileId: string, ocr: OcrResult) => Promise<void>;
};

export type AnalysisInput = {
  layers: Layers;
  settings: EffectiveSettings;
  resolution: ModeResolution;
  files: FileEntry[];
  readFile: (file: FileEntry) => Promise<Uint8Array>;
  ocrCache: OcrCache;
  profile: RecipientProfile;
  recipient: Recipient;
  otherClientNames: string[];
  protectedTerms: string[];
  progress: JobProgress;
};

export type AnalysisResult = {
  /** The input files with status, failureReason, and aiAnalysis set. */
  files: FileEntry[];
  candidates: ProfiledCandidate[];
  quotesDropped: number;
  lowConfidenceFileIds: string[];
  /** The mode at the end: rules-only when the model failed during the scan. */
  mode: Mode;
  modeFallback: CoverageReport["modeFallback"];
};

/** OCR words as text: words of a line joined by spaces, lines by newlines. */
function ocrText(words: OcrWord[]): string {
  const lines = new Map<number, string[]>();

  for (const word of words) {
    lines.set(word.line, [...(lines.get(word.line) ?? []), word.text]);
  }

  return [...lines.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, line]) => line.join(" "))
    .join("\n");
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The most limited AI result wins: failed, then skipped-too-large, then done. */
function combinedAnalysis(results: AiAnalysisResult[]): AiAnalysis {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }

  if (results.some((result) => result.status === "skipped-too-large")) {
    return "skipped-too-large";
  }

  return "done";
}

export async function analyzeFiles(input: AnalysisInput): Promise<AnalysisResult> {
  const { layers, progress } = input;
  const files: FileEntry[] = [];
  const candidates: ProfiledCandidate[] = [];
  const lowConfidenceFileIds: string[] = [];
  let quotesDropped = 0;
  let mode = input.resolution.mode;
  let modeFallback: AnalysisResult["modeFallback"] = null;

  progress.setMode(mode);

  for (const file of input.files) {
    if (file.kind === "unsupported") {
      files.push({ ...file, status: "unsupported" });
      progress.setFile(file.id, "done");
      continue;
    }

    const kind = file.kind;

    try {
      progress.setFile(file.id, "reading");

      const bytes = await input.readFile(file);
      let text: string | null = null;

      if (kind === "text") {
        try {
          text = utf8.decode(bytes);
        } catch {
          throw new Error("The text is not valid UTF-8.");
        }
      }

      const structure = layers.detect.structure({ fileId: file.id, fileName: file.originalName, kind, bytes, text });

      const loadOcr = async (): Promise<OcrResult | null> => {
        if (kind !== "image") {
          return null;
        }

        progress.setFile(file.id, "ocr");

        const cached = await input.ocrCache.read(file.id);

        if (cached !== null) {
          return cached;
        }

        const fresh = await layers.detect.ocr({ fileId: file.id, fileName: file.originalName, bytes });

        await input.ocrCache.write(file.id, fresh);

        return fresh;
      };

      const [structureHits, ocr] = await Promise.all([structure, loadOcr()]);
      const analyzedText = text ?? ocrText(ocr?.words ?? []);
      const textInput = { fileId: file.id, fileName: file.originalName, text: analyzedText, ocrWords: ocr?.words ?? null };

      progress.setFile(file.id, "rules");

      const [ruleHits, termHits] = await Promise.all([
        layers.detect.rules(textInput),
        layers.detect.protectedTerms({
          ...textInput,
          protectedTerms: input.protectedTerms,
          otherClientNames: input.otherClientNames,
        }),
      ]);

      const aiHits: FindingCandidate[] = [];
      let aiAnalysis: AiAnalysis = "skipped-no-model";

      if (modeFallback !== null) {
        aiAnalysis = "failed";
      } else if (mode !== "rules-only") {
        const context = {
          settings: input.settings,
          fileId: file.id,
          fileName: file.originalName,
          contentSha256: sha256(bytes),
          recipientName: input.recipient.name,
          profile: input.profile,
          protectedTerms: input.protectedTerms,
        };

        const results: AiAnalysisResult[] = [];

        try {
          if (analyzedText.trim() !== "") {
            progress.setFile(file.id, "ai-text");
            results.push(await layers.ai.analyzeText({ ...context, text: analyzedText, ocrWords: ocr?.words ?? null }));
          }

          if (kind === "image" && mode === "full") {
            progress.setFile(file.id, "ai-vision");
            results.push(
              await layers.ai.analyzeVision({ ...context, imageBytes: bytes, mime: file.mime, ocrWords: ocr?.words ?? [] }),
            );
          }

          aiAnalysis = combinedAnalysis(results);

          // Text AI mode has no vision model: an image did not get a full AI analysis.
          if (kind === "image" && mode === "text-ai" && aiAnalysis === "done") {
            aiAnalysis = "skipped-no-model";
          }
        } catch {
          // The model failed: this and the remaining files continue rules-only (R13).
          modeFallback = { from: mode, atFileId: file.id, reason: "The model stopped answering." };
          mode = "rules-only";
          aiAnalysis = "failed";
          progress.setMode(mode);
          logEvent("model failed, rules-only from here", { fileId: file.id });
        }

        for (const result of results) {
          aiHits.push(...result.candidates);
          quotesDropped += result.quotesDropped;
        }
      }

      const merged = layers.detect.merge({ candidates: [...structureHits, ...ruleHits, ...termHits, ...aiHits] });

      candidates.push(...layers.detect.applyProfile({ candidates: merged, profile: input.profile, recipient: input.recipient }));

      if (ocr?.lowConfidence === true) {
        lowConfidenceFileIds.push(file.id);
      }

      files.push({ ...file, status: "processed", failureReason: null, aiAnalysis });
      progress.setFile(file.id, "done");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The file could not be read.";

      files.push({ ...file, status: "failed", failureReason: reason, aiAnalysis: modeFallback === null ? "skipped-no-model" : "failed" });
      progress.setFile(file.id, "failed", reason);
    }
  }

  return { files, candidates, quotesDropped, lowConfidenceFileIds, mode, modeFallback };
}

/** The recipient, its profile, and the names of the other saved recipients (other-client). */
export async function recipientContext(recipientId: string) {
  const [profiles, recipients] = await Promise.all([readProfiles(), readRecipients()]);
  const recipient = recipients.find((entry) => entry.id === recipientId);
  const profile = profiles.find((entry) => entry.id === recipient?.profileId);

  if (recipient === undefined || profile === undefined) {
    throw new ApiError("bad-request", "The package recipient or its profile no longer exists.");
  }

  const otherClientNames = recipients.flatMap((entry) => (entry.id === recipient.id ? [] : [entry.name]));

  return { recipient, profile, otherClientNames };
}

type ScanRun = {
  packageId: string;
  layers: Layers;
  settings: EffectiveSettings;
  resolution: ModeResolution;
  progress: JobProgress;
};

async function runScan(run: ScanRun): Promise<void> {
  const { packageId } = run;

  try {
    const startedAt = new Date().toISOString();
    const pkg = await readPackage(packageId);
    const context = await recipientContext(pkg.recipientId);

    const result = await analyzeFiles({
      ...context,
      layers: run.layers,
      settings: run.settings,
      resolution: run.resolution,
      files: pkg.files,
      readFile: (file) => readOriginal(packageId, file),
      ocrCache: {
        read: (fileId) => readOcr(packageId, fileId),
        write: (fileId, ocr) => writeOcr(packageId, fileId, ocr),
      },
      protectedTerms: pkg.protectedTerms,
      progress: run.progress,
    });

    const findings = await withFindingsLock(packageId, async () => {
      const next = carryDecisions(result.candidates, await readFindings(packageId));

      await writeFindings(packageId, next);

      return next;
    });

    const scanned = new Map(result.files.map((file) => [file.id, file]));

    await updatePackage(packageId, async (current) => {
      // Keep `excluded` from the current package: the user can change it during a scan.
      const files = current.files.map((file) => {
        const update = scanned.get(file.id);

        if (update === undefined) {
          return file;
        }

        return { ...file, status: update.status, failureReason: update.failureReason, aiAnalysis: update.aiAnalysis };
      });

      await writeCoverage(
        packageId,
        buildCoverage({
          files,
          findings,
          quotesDropped: result.quotesDropped,
          lowConfidenceFileIds: result.lowConfidenceFileIds,
          mode: result.mode,
          locality: run.resolution.locality,
          models: run.resolution.models,
          modeFallback: result.modeFallback,
        }),
      );

      return {
        ...current,
        files,
        status: "scanned",
        lastScan: {
          mode: run.resolution.mode,
          locality: run.resolution.locality,
          models: run.resolution.models,
          startedAt,
          finishedAt: new Date().toISOString(),
        },
      };
    });

    logEvent("scan done", { packageId, files: pkg.files.length, findings: findings.length, mode: result.mode });
  } catch (error) {
    await updatePackage(packageId, (current) => ({ ...current, status: statusBeforeJob(current) }));

    throw error;
  }
}

function remoteAllowedInDevelopment(): boolean {
  return process.env.SENTINEL_ALLOW_REMOTE === "true" && process.env.NODE_ENV === "development";
}

/** Starts a scan job, or returns the job that already runs for the package. */
export async function startScan(packageId: string, body: ScanStartBody, layers: Layers): Promise<Job> {
  const pkg = await readCurrentPackage(packageId);
  const running = liveJob(packageId);

  if (running !== null) {
    return running;
  }

  const settings = await readEffectiveSettings();
  const resolution = await layers.ai.resolveMode({ settings });
  const confirmed = pkg.remoteConfirmed || body.confirmRemote;

  // A remote model endpoint needs an explicit confirmation per package (R16).
  if (resolution.locality === "remote" && !confirmed && !remoteAllowedInDevelopment()) {
    throw new ApiError("remote-not-confirmed", "The model server is remote. Confirm that file content can leave this machine.");
  }

  await updatePackage(packageId, (current) => ({
    ...current,
    status: "scanning",
    interrupted: false,
    remoteConfirmed: current.remoteConfirmed || body.confirmRemote,
  }));

  return startJob({
    packageId,
    kind: "scan",
    fileIds: pkg.files.map((file) => file.id),
    run: (progress) => runScan({ packageId, layers, settings, resolution, progress }),
  });
}
