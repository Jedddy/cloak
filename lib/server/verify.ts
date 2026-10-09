import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { EffectiveSettings, Layers } from "@/lib/contract/interfaces";
import {
  NO_OPEN_FINDINGS_TEXT,
  documentFormat,
  type DocumentNote,
  type FileEntry,
  type Finding,
  type FindingCandidate,
  type ModeResolution,
  type OcrResult,
  type Recipient,
  type RecipientProfile,
  type VerificationResult,
} from "@/lib/contract/schemas";

import { findingQuotes, sharesEvidence } from "./carry";
import { buildCoverage } from "./coverage";
import type { JobProgress } from "./jobs";
import { analyzeFiles } from "./pipeline";

// Verification runs the full pipeline on the reviewed copies (R22, M16).
// Each finding maps back to a finding on the original file: an existing
// one, or a new open one that the user decides on before the next export.

export type ReviewedCopy = {
  /** The original's entry: verification findings use the original file id. */
  file: FileEntry;
  path: string;
  /** Document copies: text approved for removal, checked again in the reviewed file. */
  needles: string[];
  /** Document copies: what the redactor changed or could not check. */
  notes: DocumentNote[];
};

export type VerifyInput = {
  layers: Layers;
  settings: EffectiveSettings;
  resolution: ModeResolution;
  copies: ReviewedCopy[];
  findings: Finding[];
  profile: RecipientProfile;
  recipient: Recipient;
  otherClientNames: string[];
  protectedTerms: string[];
  progress: JobProgress;
};

export type VerifyOutput = {
  verification: VerificationResult;
  /** Findings on the reviewed copies that match no finding on the original. */
  newFindings: Finding[];
};

function quotes(finding: FindingCandidate): Set<string> {
  return new Set(findingQuotes(finding).map((quote) => quote.trim().toLowerCase()));
}

/** Text redaction shifts spans, so a shared quote also counts as the same finding. */
function sameFinding(candidate: FindingCandidate, original: Finding): boolean {
  if (candidate.fileId !== original.fileId || candidate.category !== original.category) {
    return false;
  }

  if (sharesEvidence(candidate, original)) {
    return true;
  }

  const originalQuotes = quotes(original);

  return [...quotes(candidate)].some((quote) => originalQuotes.has(quote));
}

/** Open, or marked redact but still found on the reviewed copy. */
function stillOpen(finding: Finding): boolean {
  return finding.decision === "open" || finding.decision === "redact";
}

export async function verifyReviewed(input: VerifyInput): Promise<VerifyOutput> {
  const paths = new Map(input.copies.map((copy) => [copy.file.id, copy.path]));
  const ocr = new Map<string, OcrResult>();

  const analysis = await analyzeFiles({
    ...input,
    files: input.copies.map((copy) => ({ ...copy.file, status: "pending" })),
    readFile: async (file) => new Uint8Array(await readFile(/*turbopackIgnore: true*/ paths.get(file.id) ?? "")),
    // New OCR of the reviewed copies stays in memory; derived/ keeps the originals' OCR.
    ocrCache: {
      read: async (fileId) => ocr.get(fileId) ?? null,
      write: async (fileId, result) => {
        ocr.set(fileId, result);
      },
    },
  });

  const newFindings: Finding[] = [];
  const matched = new Map<string, Finding>();
  const candidates = [...analysis.candidates];

  for (const copy of input.copies) {
    const format = documentFormat(copy.file.mime);

    if (copy.file.kind !== "document" || format === null || copy.needles.length === 0) {
      continue;
    }

    const bytes = new Uint8Array(await readFile(/*turbopackIgnore: true*/ copy.path));

    for (const needle of await input.layers.document.residue({ format, bytes, needles: copy.needles })) {
      // Built already profiled: a recipient allow rule must not hide leftover text.
      candidates.push({
          fileId: copy.file.id,
          category: "hidden-data",
          detections: [
            {
              method: "structure",
              ruleId: "residue",
              evidence: [
                { type: "file-structure", note: `"${needle}" is still in the reviewed copy.`, byteOffset: null, anchor: `residue:${needle.toLowerCase()}` },
              ],
            },
          ],
          title: "Redacted text still present in the reviewed copy",
          reason: "Text that was approved for removal is still in the reviewed file.",
          relatedGroupId: null,
          suggestedAction: "redact",
          allowedByRecipient: false,
      });
    }
  }

  for (const candidate of candidates) {
    const original = input.findings.find((finding) => sameFinding(candidate, finding));

    if (original !== undefined) {
      matched.set(original.id, original);
      continue;
    }

    newFindings.push({ ...candidate, id: `fnd-${randomUUID()}`, decision: "open" });
  }

  const reported = [...matched.values(), ...newFindings];
  const openFindings = reported.filter(stillOpen);

  const coverage = buildCoverage({
    files: analysis.files,
    findings: reported,
    quotesDropped: analysis.quotesDropped,
    lowConfidenceFileIds: analysis.lowConfidenceFileIds,
    mode: analysis.mode,
    locality: input.resolution.locality,
    models: input.resolution.models,
    modeFallback: analysis.modeFallback,
    documentNotes: [...analysis.documentNotes, ...input.copies.flatMap((copy) => copy.notes)],
  });

  let text = NO_OPEN_FINDINGS_TEXT;

  if (openFindings.length > 0) {
    text = `${openFindings.length} open findings on the reviewed copies. Decide on the original files, then export again.`;
  }

  return {
    verification: {
      status: openFindings.length === 0 ? "no-open-findings" : "open-findings",
      text,
      openFindings,
      coverage: { ...coverage, findingsOpen: openFindings.length },
      originalsUnchanged: true,
      checkedAt: new Date().toISOString(),
    },
    newFindings,
  };
}
