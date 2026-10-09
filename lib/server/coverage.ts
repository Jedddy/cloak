import type {
  AiAnalysis,
  Category,
  CoverageReport,
  DocumentNote,
  FileEntry,
  Finding,
  Locality,
  Mode,
  Models,
} from "@/lib/contract/schemas";

// Coverage follows overview section 16: a file with a problem is always
// listed, so it never shows as done without a marker (R14).

export type CoverageInput = {
  files: FileEntry[];
  findings: Finding[];
  quotesDropped: number;
  lowConfidenceFileIds: string[];
  mode: Mode;
  locality: Locality;
  models: Models;
  modeFallback: CoverageReport["modeFallback"];
  documentNotes?: DocumentNote[];
};

const noAiReasons: Record<Exclude<AiAnalysis, "done">, string> = {
  "skipped-no-model": "No model was available.",
  "skipped-too-large": "The file is too large for AI analysis.",
  failed: "The model failed during the scan.",
};

/** Counts that change with each decision: open findings and findings per category. */
export function countFindings(files: FileEntry[], findings: Finding[]) {
  const excluded = new Set(files.flatMap((file) => (file.excluded ? [file.id] : [])));
  const counted = findings.filter((finding) => !excluded.has(finding.fileId));
  const findingsByCategory: Partial<Record<Category, number>> = {};

  for (const finding of counted) {
    findingsByCategory[finding.category] = (findingsByCategory[finding.category] ?? 0) + 1;
  }

  return {
    findingsOpen: counted.filter((finding) => finding.decision === "open").length,
    findingsByCategory,
  };
}

export function buildCoverage(input: CoverageInput): CoverageReport {
  const { files } = input;

  return {
    filesTotal: files.length,
    filesProcessed: files.filter((file) => file.status === "processed").length,
    filesFailed: files.flatMap((file) =>
      file.status === "failed" ? [{ fileId: file.id, reason: file.failureReason ?? "The file could not be read." }] : [],
    ),
    filesUnsupported: files.flatMap((file) => (file.status === "unsupported" ? [file.id] : [])),
    filesExcluded: files.flatMap((file) => (file.excluded ? [file.id] : [])),
    filesWithoutAi: files.flatMap((file) => {
      if (file.status !== "processed" || file.aiAnalysis === "done") {
        return [];
      }

      return [{ fileId: file.id, reason: noAiReasons[file.aiAnalysis] }];
    }),
    filesLowConfidenceOcr: input.lowConfidenceFileIds,
    ...countFindings(files, input.findings),
    llmQuotesDropped: input.quotesDropped,
    mode: input.mode,
    locality: input.locality,
    models: input.models,
    modeFallback: input.modeFallback,
    documentNotes: input.documentNotes ?? [],
  };
}
