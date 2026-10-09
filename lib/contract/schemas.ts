import { z } from "zod";

// Field names mirror sentineldesk-overview.md section 10, so the overview
// stays readable as documentation for every stream.

// ---------------------------------------------------------------------------
// Domain unions
// ---------------------------------------------------------------------------

export const LocalitySchema = z.enum(["local", "lan", "remote", "mock"]);

export type Locality = z.infer<typeof LocalitySchema>;

export const ModeSchema = z.enum(["full", "text-ai", "rules-only"]);

export type Mode = z.infer<typeof ModeSchema>;

export const ProviderSchema = z.enum(["openai-compatible", "mock"]);

export type Provider = z.infer<typeof ProviderSchema>;

export const CategorySchema = z.enum([
  "secret",
  "personal-contact",
  "personal-id",
  "other-client",
  "protected-term",
  "internal-pricing",
  "internal-infra",
  "unreleased-work",
  "metadata",
  "hidden-data",
  "prompt-injection",
  "other",
]);

export type Category = z.infer<typeof CategorySchema>;

export const DetectionMethodSchema = z.enum([
  "rule",
  "protected-term",
  "ocr-rule",
  "llm-text",
  "llm-vision",
  "structure",
  "manual",
]);

export type DetectionMethod = z.infer<typeof DetectionMethodSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Non-secret model settings. The API key is never part of this type. */
export const SettingsSchema = z.strictObject({
  baseUrl: z.string().min(1),
  textModel: z.string().min(1).nullable(),
  visionModel: z.string().min(1).nullable(),
  timeoutMs: z.number().int().positive(),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** `workspace/config.json`: saved values replace env values (KTD8). */
export const SavedSettingsSchema = SettingsSchema.partial();

export type SavedSettings = z.infer<typeof SavedSettingsSchema>;

/** PUT /api/settings body. Strict, so an API key can never be submitted. */
export const SettingsUpdateBodySchema = SettingsSchema;

export type SettingsUpdateBody = z.infer<typeof SettingsUpdateBodySchema>;

/** GET /api/settings response. Strict, so a key value can never travel. */
export const SettingsResponseSchema = SettingsSchema.extend({
  provider: ProviderSchema,
  apiKeySet: z.boolean(),
});

export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

export const ModelsSchema = z.object({
  text: z.string().nullable(),
  vision: z.string().nullable(),
});

export type Models = z.infer<typeof ModelsSchema>;

export const ConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.string()),
  jsonTest: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  latencyMs: z.number().nonnegative().nullable(),
  locality: LocalitySchema,
  mode: ModeSchema,
  error: z.string().nullable(),
});

export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;

export const ModeResolutionSchema = z.object({
  mode: ModeSchema,
  locality: LocalitySchema,
  models: ModelsSchema,
});

export type ModeResolution = z.infer<typeof ModeResolutionSchema>;

// ---------------------------------------------------------------------------
// Profiles and recipients
// ---------------------------------------------------------------------------

export const RecipientProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  allowed: z.array(CategorySchema),
  needsDecision: z.array(CategorySchema),
  remove: z.array(CategorySchema),
});

export type RecipientProfile = z.infer<typeof RecipientProfileSchema>;

/** POST /api/profiles body: no id creates, an id updates. */
export const ProfileUpsertBodySchema = RecipientProfileSchema.extend({
  id: z.string().min(1).optional(),
});

export type ProfileUpsertBody = z.infer<typeof ProfileUpsertBodySchema>;

export const AllowRuleSchema = z.object({
  id: z.string().min(1),
  category: CategorySchema.exclude(["secret"]),
  matchText: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type AllowRule = z.infer<typeof AllowRuleSchema>;

export const RecipientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profileId: z.string().min(1),
  allowRules: z.array(AllowRuleSchema),
});

export type Recipient = z.infer<typeof RecipientSchema>;

/** POST /api/recipients body: no id creates, an id updates name and profile. */
export const RecipientUpsertBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  profileId: z.string().min(1),
});

export type RecipientUpsertBody = z.infer<typeof RecipientUpsertBodySchema>;

// ---------------------------------------------------------------------------
// Packages and files
// ---------------------------------------------------------------------------

export const FileKindSchema = z.enum(["image", "text", "unsupported"]);

export type FileKind = z.infer<typeof FileKindSchema>;

export const FileStatusSchema = z.enum([
  "pending",
  "processed",
  "failed",
  "unsupported",
]);

export type FileStatus = z.infer<typeof FileStatusSchema>;

export const AiAnalysisSchema = z.enum([
  "done",
  "skipped-no-model",
  "skipped-too-large",
  "failed",
]);

export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;

/** Upload limits (R9). Larger files and more files are rejected. */
export const UPLOAD_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerPackage: 50,
} as const;

export const FileEntrySchema = z.object({
  id: z.string().min(1),
  originalName: z.string().min(1),
  kind: FileKindSchema,
  mime: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: FileStatusSchema,
  failureReason: z.string().nullable(),
  aiAnalysis: AiAnalysisSchema,
  excluded: z.boolean(),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

export const ScanInfoSchema = z.object({
  mode: ModeSchema,
  locality: LocalitySchema,
  models: ModelsSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export type ScanInfo = z.infer<typeof ScanInfoSchema>;

export const PackageStatusSchema = z.enum([
  "draft",
  "scanning",
  "scanned",
  "exporting",
  "exported",
]);

export type PackageStatus = z.infer<typeof PackageStatusSchema>;

export const PackageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  recipientId: z.string().min(1),
  protectedTerms: z.array(z.string().min(1)),
  files: z.array(FileEntrySchema),
  status: PackageStatusSchema,
  createdAt: z.iso.datetime(),
  lastScan: ScanInfoSchema.nullable(),
  /** The user confirmed a remote model endpoint for this package (R16). */
  remoteConfirmed: z.boolean().default(false),
  /** The last scan or export stopped with the server; cleared by the next job (KTD5). */
  interrupted: z.boolean().default(false),
});

export type Package = z.infer<typeof PackageSchema>;

export const PackageCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  recipientId: z.string().min(1),
  protectedTerms: z.array(z.string().trim().min(1)).default([]),
});

export type PackageCreateBody = z.infer<typeof PackageCreateBodySchema>;

export const FileUpdateBodySchema = z.object({ excluded: z.boolean() });

export type FileUpdateBody = z.infer<typeof FileUpdateBodySchema>;

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export const BoxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export type Box = z.infer<typeof BoxSchema>;

export const OcrWordSchema = z.object({
  text: z.string(),
  box: BoxSchema,
  confidence: z.number().min(0).max(100),
  line: z.number().int().nonnegative(),
});

export type OcrWord = z.infer<typeof OcrWordSchema>;

/** `derived/<file-id>.ocr.json` and GET .../files/[fileId]/ocr. */
export const OcrResultSchema = z.object({
  words: z.array(OcrWordSchema),
  lowConfidence: z.boolean(),
});

export type OcrResult = z.infer<typeof OcrResultSchema>;

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export const EvidenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text-span"),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    line: z.number().int().nonnegative(),
    quote: z.string(),
  }),
  z.object({
    type: z.literal("image-region"),
    box: BoxSchema,
    quote: z.string().nullable(),
  }),
  z.object({ type: z.literal("image-whole"), note: z.string() }),
  z.object({
    type: z.literal("file-structure"),
    note: z.string(),
    byteOffset: z.number().int().nonnegative().nullable(),
  }),
]);

export type Evidence = z.infer<typeof EvidenceSchema>;

export const DetectionSchema = z.object({
  method: DetectionMethodSchema,
  ruleId: z.string().nullable(),
  evidence: z.array(EvidenceSchema).min(1),
});

export type Detection = z.infer<typeof DetectionSchema>;

export const SuggestedActionSchema = z.enum(["redact", "needs-decision", "keep"]);

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

export const DecisionSchema = z.enum([
  "open",
  "redact",
  "keep",
  "keep-and-remember",
  "not-an-issue",
]);

export type Decision = z.infer<typeof DecisionSchema>;

/** What a detection layer reports, before profile and decisions. */
export const FindingCandidateSchema = z.object({
  fileId: z.string().min(1),
  category: CategorySchema,
  detections: z.array(DetectionSchema),
  title: z.string(),
  reason: z.string(),
  relatedGroupId: z.string().nullable(),
});

export type FindingCandidate = z.infer<typeof FindingCandidateSchema>;

/** A candidate after profile and recipient allow rules (Stream 2). */
export const ProfiledCandidateSchema = FindingCandidateSchema.extend({
  suggestedAction: SuggestedActionSchema,
  /** True when an allow rule of the recipient set `keep`: "allowed for this recipient". */
  allowedByRecipient: z.boolean(),
});

export type ProfiledCandidate = z.infer<typeof ProfiledCandidateSchema>;

export const FindingSchema = ProfiledCandidateSchema.extend({
  id: z.string().min(1),
  decision: DecisionSchema,
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingDecisionBodySchema = z.object({
  decision: DecisionSchema,
  /** Apply the decision to every finding with the same relatedGroupId (M13). */
  applyToGroup: z.boolean().default(false),
});

export type FindingDecisionBody = z.infer<typeof FindingDecisionBodySchema>;

export const RegionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    fileId: z.string().min(1),
    box: BoxSchema,
    category: CategorySchema.default("other"),
  }),
  z.object({
    action: z.literal("update"),
    findingId: z.string().min(1),
    box: BoxSchema,
  }),
  z.object({ action: z.literal("delete"), findingId: z.string().min(1) }),
]);

export type RegionBody = z.infer<typeof RegionBodySchema>;

// ---------------------------------------------------------------------------
// Package checks and related occurrences
// ---------------------------------------------------------------------------

export const PackageWarningSchema = z.object({
  type: z.literal("inconsistent-redaction"),
  term: z.string(),
  relatedGroupId: z.string().nullable(),
  redactedFileIds: z.array(z.string()),
  visibleFileIds: z.array(z.string()),
  /** "'Juniper' is redacted in notes.md but still visible in screenshot-01.png." */
  message: z.string(),
});

export type PackageWarning = z.infer<typeof PackageWarningSchema>;

export const RelatedBodySchema = z.object({ term: z.string().trim().min(1) });

export type RelatedBody = z.infer<typeof RelatedBodySchema>;

/** Both lists share relatedGroupId; AI suggestions are shown as their own group. */
export const RelatedResultSchema = z.object({
  term: z.string(),
  relatedGroupId: z.string(),
  exact: z.array(FindingSchema),
  aiSuggestions: z.array(FindingSchema),
});

export type RelatedResult = z.infer<typeof RelatedResultSchema>;

export const FindingDecisionResultSchema = z.object({
  findings: z.array(FindingSchema),
  warnings: z.array(PackageWarningSchema),
});

export type FindingDecisionResult = z.infer<typeof FindingDecisionResultSchema>;

// ---------------------------------------------------------------------------
// Coverage, jobs, verification
// ---------------------------------------------------------------------------

export const FileProblemSchema = z.object({
  fileId: z.string(),
  reason: z.string(),
});

export type FileProblem = z.infer<typeof FileProblemSchema>;

export const CoverageReportSchema = z.object({
  filesTotal: z.number().int().nonnegative(),
  filesProcessed: z.number().int().nonnegative(),
  filesFailed: z.array(FileProblemSchema),
  filesUnsupported: z.array(z.string()),
  filesExcluded: z.array(z.string()),
  filesWithoutAi: z.array(FileProblemSchema),
  filesLowConfidenceOcr: z.array(z.string()),
  findingsOpen: z.number().int().nonnegative(),
  findingsByCategory: z.partialRecord(CategorySchema, z.number().int()),
  llmQuotesDropped: z.number().int().nonnegative(),
  mode: ModeSchema,
  locality: LocalitySchema,
  models: ModelsSchema,
  /** Set when the model failed during the scan and later files ran rules-only. */
  modeFallback: z
    .object({ from: ModeSchema, atFileId: z.string(), reason: z.string() })
    .nullable(),
});

export type CoverageReport = z.infer<typeof CoverageReportSchema>;

export const JobKindSchema = z.enum(["scan", "export"]);

export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(["queued", "running", "done", "failed"]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

export const FileProgressStatusSchema = z.enum([
  "queued",
  "reading",
  "ocr",
  "rules",
  "ai-text",
  "ai-vision",
  "done",
  "failed",
]);

export type FileProgressStatus = z.infer<typeof FileProgressStatusSchema>;

export const FileProgressSchema = z.object({
  fileId: z.string(),
  status: FileProgressStatusSchema,
  reason: z.string().nullable(),
});

export type FileProgress = z.infer<typeof FileProgressSchema>;

export const JobSchema = z.object({
  id: z.string().min(1),
  packageId: z.string().min(1),
  kind: JobKindSchema,
  status: JobStatusSchema,
  /** Current scan mode; changes to rules-only when the model fails mid-scan. */
  mode: ModeSchema.nullable(),
  files: z.array(FileProgressSchema),
  error: z.string().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export type Job = z.infer<typeof JobSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export type OkResponse = z.infer<typeof OkResponseSchema>;

export const JobStartResponseSchema = z.object({ jobId: z.string() });

export type JobStartResponse = z.infer<typeof JobStartResponseSchema>;

export const ScanStartBodySchema = z.object({
  confirmRemote: z.boolean().default(false),
});

export type ScanStartBody = z.infer<typeof ScanStartBodySchema>;

export const ExportStartBodySchema = z.object({
  confirmWarnings: z.boolean().default(false),
});

export type ExportStartBody = z.infer<typeof ExportStartBodySchema>;

/** The only words verification may use when nothing open is found (M16). */
export const NO_OPEN_FINDINGS_TEXT = "Reviewed. No open detected findings.";

export const VerificationResultSchema = z.object({
  status: z.enum(["no-open-findings", "open-findings"]),
  /** NO_OPEN_FINDINGS_TEXT, or a count of open findings. */
  text: z.string(),
  /** Findings on the reviewed copies, mapped back to original file ids. */
  openFindings: z.array(FindingSchema),
  coverage: CoverageReportSchema,
  originalsUnchanged: z.boolean(),
  checkedAt: z.iso.datetime(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/** GET /api/packages/[id]. */
export const PackageDetailSchema = z.object({
  package: PackageSchema,
  findings: z.array(FindingSchema),
  coverage: CoverageReportSchema.nullable(),
  warnings: z.array(PackageWarningSchema),
  verification: VerificationResultSchema.nullable(),
  /** The last scan or export stopped with the server; the user can start again (KTD5). */
  interrupted: z.boolean(),
});

export type PackageDetail = z.infer<typeof PackageDetailSchema>;
