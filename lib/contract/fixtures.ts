import {
  NO_OPEN_FINDINGS_TEXT,
  type ConnectionTestResult,
  type CoverageReport,
  type FileEntry,
  type Finding,
  type Job,
  type ModeResolution,
  type OcrResult,
  type Package,
  type PackageDetail,
  type PackageWarning,
  type Recipient,
  type RecipientProfile,
  type RelatedResult,
  type ScanInfo,
  type SettingsResponse,
  type VerificationResult,
} from "./schemas";

// The demo package of overview section 3. All data is fictional.

const scannedAt = "2026-10-09T08:00:00.000Z";

const finishedAt = "2026-10-09T08:01:30.000Z";

// ---------------------------------------------------------------------------
// Profiles and recipients (overview section 22 defaults)
// ---------------------------------------------------------------------------

export const fixtureProfiles: RecipientProfile[] = [
  {
    id: "profile-external-contractor",
    name: "External contractor",
    description: "A person outside the company who works on one project.",
    allowed: [],
    needsDecision: ["personal-contact", "internal-infra", "unreleased-work"],
    remove: [
      "secret",
      "other-client",
      "internal-pricing",
      "protected-term",
      "metadata",
      "hidden-data",
    ],
  },
  {
    id: "profile-client",
    name: "Client",
    description: "The client that owns the project.",
    allowed: ["internal-infra"],
    needsDecision: ["personal-contact", "unreleased-work", "internal-pricing"],
    remove: [
      "secret",
      "other-client",
      "protected-term",
      "metadata",
      "hidden-data",
    ],
  },
  {
    id: "profile-public-portfolio",
    name: "Public portfolio",
    description: "Anyone on the internet.",
    allowed: [],
    needsDecision: ["other"],
    remove: [
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
    ],
  },
];

export const fixtureRecipients: Recipient[] = [
  {
    id: "recipient-northwind",
    name: "Northwind Studio",
    profileId: "profile-external-contractor",
    allowRules: [],
  },
  {
    id: "recipient-acme",
    name: "Acme Corp",
    profileId: "profile-client",
    allowRules: [
      {
        id: "allow-acme-host",
        category: "internal-infra",
        matchText: "staging.acme.dev",
        createdAt: scannedAt,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Package and files
// ---------------------------------------------------------------------------

export const fixtureFileIds = {
  screenshot01: "file-screenshot-01",
  screenshot02: "file-screenshot-02",
  notes: "file-notes",
  envExample: "file-env-example",
  spec: "file-spec",
  broken: "file-broken",
} as const;

export const fixtureFiles: FileEntry[] = [
  {
    id: fixtureFileIds.screenshot01,
    originalName: "screenshot-01.png",
    kind: "image",
    mime: "image/png",
    sizeBytes: 482_113,
    sha256: "1".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "done",
    excluded: false,
  },
  {
    id: fixtureFileIds.screenshot02,
    originalName: "screenshot-02.png",
    kind: "image",
    mime: "image/png",
    sizeBytes: 391_540,
    sha256: "2".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "done",
    excluded: false,
  },
  {
    id: fixtureFileIds.notes,
    originalName: "notes.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: 1_204,
    sha256: "3".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "done",
    excluded: false,
  },
  {
    id: fixtureFileIds.envExample,
    originalName: ".env.example",
    kind: "text",
    mime: "text/plain",
    sizeBytes: 212,
    sha256: "4".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "done",
    excluded: false,
  },
  {
    id: fixtureFileIds.spec,
    originalName: "spec.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: 2_840,
    sha256: "5".repeat(64),
    status: "processed",
    failureReason: null,
    aiAnalysis: "done",
    excluded: false,
  },
  {
    id: fixtureFileIds.broken,
    originalName: "broken.png",
    kind: "image",
    mime: "image/png",
    sizeBytes: 5_120,
    sha256: "6".repeat(64),
    status: "failed",
    failureReason: "The image data cannot be read.",
    aiAnalysis: "skipped-no-model",
    excluded: false,
  },
];

export const fixtureScanInfo: ScanInfo = {
  mode: "full",
  locality: "mock",
  models: { text: "mock-text", vision: "mock-vision" },
  startedAt: scannedAt,
  finishedAt,
};

export const fixturePackage: Package = {
  id: "pkg-demo",
  name: "Contractor handoff",
  recipientId: "recipient-northwind",
  protectedTerms: ["Juniper"],
  files: fixtureFiles,
  status: "scanned",
  createdAt: "2026-10-09T07:55:00.000Z",
  lastScan: fixtureScanInfo,
  remoteConfirmed: false,
};

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export const fixtureOcrScreenshot01: OcrResult = {
  lowConfidence: false,
  words: [
    { text: "Acme", box: { x: 112, y: 8, w: 52, h: 18 }, confidence: 94, line: 0 },
    { text: "Corp", box: { x: 168, y: 8, w: 48, h: 18 }, confidence: 93, line: 0 },
    { text: "Juniper", box: { x: 240, y: 8, w: 70, h: 18 }, confidence: 91, line: 0 },
    {
      text: "jane.doe@example.com",
      box: { x: 980, y: 64, w: 210, h: 20 },
      confidence: 88,
      line: 1,
    },
  ],
};

export const fixtureOcrByFileName: ReadonlyMap<string, OcrResult> = new Map([
  ["screenshot-01.png", fixtureOcrScreenshot01],
  ["screenshot-02.png", { lowConfidence: true, words: [] }],
]);

// ---------------------------------------------------------------------------
// Findings: one or more per detection method
// ---------------------------------------------------------------------------

export const fixtureFindings: Finding[] = [
  {
    id: "fnd-env-secret",
    fileId: fixtureFileIds.envExample,
    category: "secret",
    detections: [
      {
        method: "rule",
        ruleId: "openai-style-key",
        evidence: [
          {
            type: "text-span",
            start: 15,
            end: 66,
            line: 1,
            quote: "sk-fixture-0000000000000000000000000000000000000000",
          },
        ],
      },
    ],
    title: "Possible access token",
    reason: "This can give access to an account.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
  {
    id: "fnd-notes-juniper",
    fileId: fixtureFileIds.notes,
    category: "protected-term",
    detections: [
      {
        method: "protected-term",
        ruleId: null,
        evidence: [
          { type: "text-span", start: 22, end: 29, line: 2, quote: "Juniper" },
        ],
      },
    ],
    title: "Protected term: Juniper",
    reason: "You marked this term as sensitive for this package.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: "rel-juniper",
  },
  {
    id: "fnd-notes-pricing",
    fileId: fixtureFileIds.notes,
    category: "internal-pricing",
    detections: [
      {
        method: "llm-text",
        ruleId: null,
        evidence: [
          {
            type: "text-span",
            start: 140,
            end: 178,
            line: 6,
            quote: "Our day rate for Acme is 1,450 EUR",
          },
        ],
      },
    ],
    title: "Internal pricing",
    reason: "A contractor should not see the rate charged to another client.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
  {
    id: "fnd-shot1-email",
    fileId: fixtureFileIds.screenshot01,
    category: "personal-contact",
    detections: [
      {
        method: "ocr-rule",
        ruleId: "email",
        evidence: [
          {
            type: "image-region",
            box: { x: 980, y: 64, w: 210, h: 20 },
            quote: "jane.doe@example.com",
          },
        ],
      },
    ],
    title: "Email address",
    reason: "A customer email address is visible in a notification.",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
  {
    id: "fnd-shot1-client",
    fileId: fixtureFileIds.screenshot01,
    category: "other-client",
    detections: [
      {
        method: "protected-term",
        ruleId: null,
        evidence: [
          {
            type: "image-region",
            box: { x: 112, y: 8, w: 104, h: 18 },
            quote: "Acme Corp",
          },
        ],
      },
      {
        method: "llm-vision",
        ruleId: null,
        evidence: [
          {
            type: "image-region",
            box: { x: 112, y: 8, w: 104, h: 18 },
            quote: "Acme Corp",
          },
        ],
      },
    ],
    title: "Other client: Acme Corp",
    reason: "The browser tab bar shows another client's project.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
  {
    id: "fnd-shot1-juniper",
    fileId: fixtureFileIds.screenshot01,
    category: "protected-term",
    detections: [
      {
        method: "protected-term",
        ruleId: null,
        evidence: [
          {
            type: "image-region",
            box: { x: 240, y: 8, w: 70, h: 18 },
            quote: "Juniper",
          },
        ],
      },
    ],
    title: "Protected term: Juniper",
    reason: "You marked this term as sensitive for this package.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: "rel-juniper",
  },
  {
    id: "fnd-shot1-sidebar",
    fileId: fixtureFileIds.screenshot01,
    category: "unreleased-work",
    detections: [
      {
        method: "llm-vision",
        ruleId: null,
        evidence: [
          {
            type: "image-whole",
            note: "The sidebar shows the names of unreleased projects.",
          },
        ],
      },
    ],
    title: "Unreleased work in the sidebar",
    reason: "Draw a box over the sidebar to redact it.",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
  {
    id: "fnd-shot1-manual",
    fileId: fixtureFileIds.screenshot01,
    category: "other",
    detections: [
      {
        method: "manual",
        ruleId: null,
        evidence: [
          {
            type: "image-region",
            box: { x: 0, y: 120, w: 220, h: 600 },
            quote: null,
          },
        ],
      },
    ],
    title: "Manual region",
    reason: "You drew this region.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  },
  {
    id: "fnd-shot2-trailing",
    fileId: fixtureFileIds.screenshot02,
    category: "hidden-data",
    detections: [
      {
        method: "structure",
        ruleId: "png-trailing-data",
        evidence: [
          {
            type: "file-structure",
            note: "182,044 bytes after the PNG IEND chunk. The cropped part of the image can be recovered.",
            byteOffset: 209_496,
          },
        ],
      },
    ],
    title: "Hidden data after the image",
    reason: "The cropped-out part of the screenshot is still in the file.",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId: null,
  },
];

// ---------------------------------------------------------------------------
// Package checks, coverage, jobs, verification
// ---------------------------------------------------------------------------

export const fixtureWarnings: PackageWarning[] = [
  {
    type: "inconsistent-redaction",
    term: "Juniper",
    relatedGroupId: "rel-juniper",
    redactedFileIds: [fixtureFileIds.notes],
    visibleFileIds: [fixtureFileIds.screenshot01],
    message: "'Juniper' is redacted in notes.md but still visible in screenshot-01.png.",
  },
];

export const fixtureCoverage: CoverageReport = {
  filesTotal: 6,
  filesProcessed: 5,
  filesFailed: [
    { fileId: fixtureFileIds.broken, reason: "The image data cannot be read." },
  ],
  filesUnsupported: [],
  filesExcluded: [],
  filesWithoutAi: [],
  filesLowConfidenceOcr: [fixtureFileIds.screenshot02],
  findingsOpen: 6,
  findingsByCategory: {
    secret: 1,
    "protected-term": 2,
    "internal-pricing": 1,
    "personal-contact": 1,
    "other-client": 1,
    "unreleased-work": 1,
    other: 1,
    "hidden-data": 1,
  },
  llmQuotesDropped: 1,
  mode: "full",
  locality: "mock",
  models: { text: "mock-text", vision: "mock-vision" },
  modeFallback: null,
};

export const fixtureJob: Job = {
  id: "job-demo-scan",
  packageId: fixturePackage.id,
  kind: "scan",
  status: "done",
  mode: "full",
  files: fixtureFiles.map((file) => ({
    fileId: file.id,
    status: file.status === "failed" ? "failed" : "done",
    reason: file.failureReason,
  })),
  error: null,
  startedAt: scannedAt,
  finishedAt,
};

export const fixtureVerification: VerificationResult = {
  status: "no-open-findings",
  text: NO_OPEN_FINDINGS_TEXT,
  openFindings: [],
  coverage: { ...fixtureCoverage, findingsOpen: 0, findingsByCategory: {} },
  originalsUnchanged: true,
  checkedAt: finishedAt,
};

export const fixturePackageDetail: PackageDetail = {
  package: fixturePackage,
  findings: fixtureFindings,
  coverage: fixtureCoverage,
  warnings: fixtureWarnings,
  verification: null,
  interrupted: false,
};

export const fixtureRelatedResult: RelatedResult = {
  term: "Juniper",
  relatedGroupId: "rel-juniper",
  exact: fixtureFindings.filter((finding) => finding.relatedGroupId === "rel-juniper"),
  aiSuggestions: [],
};

// ---------------------------------------------------------------------------
// Settings and model access
// ---------------------------------------------------------------------------

export const fixtureSettingsResponse: SettingsResponse = {
  baseUrl: "http://127.0.0.1:11434/v1",
  textModel: "mock-text",
  visionModel: "mock-vision",
  timeoutMs: 60_000,
  provider: "mock",
  apiKeySet: false,
};

export const fixtureModeResolution: ModeResolution = {
  mode: "full",
  locality: "mock",
  models: { text: "mock-text", vision: "mock-vision" },
};

export const fixtureConnectionTest: ConnectionTestResult = {
  ok: true,
  models: ["mock-text", "mock-vision"],
  jsonTest: { ok: true, error: null },
  latencyMs: 12,
  locality: "mock",
  mode: "full",
  error: null,
};
