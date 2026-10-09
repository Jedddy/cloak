import type {
  AiAnalysis,
  Box,
  Category,
  ConnectionTestResult,
  FileEntry,
  FileKind,
  Finding,
  FindingCandidate,
  Locality,
  ModeResolution,
  OcrResult,
  OcrWord,
  PackageWarning,
  ProfiledCandidate,
  Provider,
  Recipient,
  RecipientProfile,
  Settings,
} from "./schemas";

// Layer functions take bytes, text, and context, never file paths, so
// lib/detect, lib/ai, and lib/redact stay free of file I/O (KTD2).
// Only lib/server/layers.ts picks which implementation runs.

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type StructureInput = {
  fileId: string;
  fileName: string;
  kind: Exclude<FileKind, "unsupported">;
  bytes: Uint8Array;
  /** Decoded UTF-8 text for text files; null for images. */
  text: string | null;
};

export type OcrInput = {
  fileId: string;
  fileName: string;
  bytes: Uint8Array;
};

/** Text of one file: the file content, or the OCR text with its words. */
export type TextInput = {
  fileId: string;
  fileName: string;
  text: string;
  /** OCR words for images, so evidence can map to boxes; null for text files. */
  ocrWords: OcrWord[] | null;
};

export type ProtectedTermsInput = TextInput & {
  protectedTerms: string[];
  /** Names of saved recipients other than the package's recipient (other-client). */
  otherClientNames: string[];
};

export type ApplyProfileInput = {
  candidates: FindingCandidate[];
  profile: RecipientProfile;
  recipient: Recipient;
};

export type MergeInput = {
  candidates: FindingCandidate[];
};

export type RelatedSource = {
  fileId: string;
  fileName: string;
  text: string;
  ocrWords: OcrWord[] | null;
};

export type FindRelatedInput = {
  term: string;
  sources: RelatedSource[];
};

export type InconsistentRedactionsInput = {
  findings: Finding[];
  protectedTerms: string[];
  /** For file names in warning messages. */
  files: FileEntry[];
};

/** Settings as the server resolved them (KTD8). Server-side only. */
export type EffectiveSettings = Settings & {
  provider: Provider;
  apiKey: string | null;
};

export type ConnectionInput = {
  settings: EffectiveSettings;
};

export type AnalysisContext = {
  settings: EffectiveSettings;
  fileId: string;
  fileName: string;
  /** SHA-256 of the analyzed content, for the result cache. */
  contentSha256: string;
  recipientName: string;
  profile: RecipientProfile;
  protectedTerms: string[];
};

export type TextAnalysisInput = AnalysisContext & {
  text: string;
  ocrWords: OcrWord[] | null;
};

export type VisionAnalysisInput = AnalysisContext & {
  imageBytes: Uint8Array;
  mime: string;
  ocrWords: OcrWord[];
};

export type RelatedSuggestionsInput = FindRelatedInput & {
  settings: EffectiveSettings;
};

export type ImageRedactionInput = {
  bytes: Uint8Array;
  mime: string;
  boxes: Box[];
};

export type TextRedactionSpan = {
  start: number;
  end: number;
  category: Category;
};

export type TextRedactionInput = {
  /** Used to pick the `.env` value-only rule. */
  fileName: string;
  content: string;
  spans: TextRedactionSpan[];
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type AiAnalysisResult = {
  candidates: FindingCandidate[];
  /** LLM quotes with no match in the source, dropped as unverified. */
  quotesDropped: number;
  status: Exclude<AiAnalysis, "skipped-no-model">;
};

// ---------------------------------------------------------------------------
// Layers bundle
// ---------------------------------------------------------------------------

/** Stream 2: detection layers and package checks. */
export type DetectLayer = {
  structure: (input: StructureInput) => Promise<FindingCandidate[]>;
  /** Throws when the image cannot be read; the file is then marked failed. */
  ocr: (input: OcrInput) => Promise<OcrResult>;
  rules: (input: TextInput) => Promise<FindingCandidate[]>;
  protectedTerms: (input: ProtectedTermsInput) => Promise<FindingCandidate[]>;
  applyProfile: (input: ApplyProfileInput) => ProfiledCandidate[];
  merge: (input: MergeInput) => FindingCandidate[];
  findRelatedExact: (input: FindRelatedInput) => Promise<FindingCandidate[]>;
  inconsistentRedactions: (input: InconsistentRedactionsInput) => PackageWarning[];
};

/** Stream 3: everything that talks to a model. */
export type AiLayer = {
  testConnection: (input: ConnectionInput) => Promise<ConnectionTestResult>;
  classifyLocality: (input: ConnectionInput) => Locality;
  resolveMode: (input: ConnectionInput) => Promise<ModeResolution>;
  /** Throws when the model is unreachable; the pipeline then goes rules-only. */
  analyzeText: (input: TextAnalysisInput) => Promise<AiAnalysisResult>;
  /** Throws when the model is unreachable; the pipeline then goes rules-only. */
  analyzeVision: (input: VisionAnalysisInput) => Promise<AiAnalysisResult>;
  findRelatedSuggestions: (
    input: RelatedSuggestionsInput,
  ) => Promise<FindingCandidate[]>;
};

/** Stream 2: reviewed-copy builders. */
export type RedactLayer = {
  /** A new file in the same format, with no metadata and no trailing data. */
  image: (input: ImageRedactionInput) => Promise<Uint8Array>;
  text: (input: TextRedactionInput) => string;
};

export type Layers = {
  detect: DetectLayer;
  ai: AiLayer;
  redact: RedactLayer;
};
