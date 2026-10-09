import {
  fixtureConnectionTest,
  fixtureFiles,
  fixtureFindings,
  fixtureModeResolution,
  fixtureOcrByFileName,
} from "./fixtures";
import type { Layers } from "./interfaces";
import type { DetectionMethod, FindingCandidate, SuggestedAction } from "./schemas";

// Stub layers return the demo-package fixtures by file name, so the
// pipeline runs end to end before Streams 2 and 3 merge (KTD2).

function fixtureCandidates(
  fileName: string,
  fileId: string,
  methods: DetectionMethod[],
): FindingCandidate[] {
  const fixtureFile = fixtureFiles.find((file) => file.originalName === fileName);

  if (fixtureFile === undefined) {
    return [];
  }

  return fixtureFindings.flatMap((finding) => {
    if (finding.fileId !== fixtureFile.id) {
      return [];
    }

    const detections = finding.detections.filter((detection) =>
      methods.includes(detection.method),
    );

    if (detections.length === 0) {
      return [];
    }

    return [
      {
        fileId,
        category: finding.category,
        detections,
        title: finding.title,
        reason: finding.reason,
        relatedGroupId: finding.relatedGroupId,
      },
    ];
  });
}

export const stubLayers: Layers = {
  detect: {
    structure: async (input) =>
      fixtureCandidates(input.fileName, input.fileId, ["structure"]),
    ocr: async (input) => {
      if (input.fileName === "broken.png") {
        throw new Error("The image data cannot be read.");
      }

      return fixtureOcrByFileName.get(input.fileName) ?? { words: [], lowConfidence: false };
    },
    rules: async (input) =>
      fixtureCandidates(input.fileName, input.fileId, ["rule", "ocr-rule"]),
    protectedTerms: async (input) =>
      fixtureCandidates(input.fileName, input.fileId, ["protected-term"]),
    applyProfile: (input) =>
      input.candidates.map((candidate) => {
        let suggestedAction: SuggestedAction = "needs-decision";

        if (input.profile.remove.includes(candidate.category)) {
          suggestedAction = "redact";
        } else if (input.profile.allowed.includes(candidate.category)) {
          suggestedAction = "keep";
        }

        return { ...candidate, suggestedAction, allowedByRecipient: false };
      }),
    merge: (input) => input.candidates,
    findRelatedExact: async () => [],
    inconsistentRedactions: () => [],
  },
  ai: {
    testConnection: async () => fixtureConnectionTest,
    classifyLocality: () => "mock",
    resolveMode: async () => fixtureModeResolution,
    analyzeText: async (input) => ({
      candidates: fixtureCandidates(input.fileName, input.fileId, ["llm-text"]),
      quotesDropped: 0,
      status: "done",
    }),
    analyzeVision: async (input) => ({
      candidates: fixtureCandidates(input.fileName, input.fileId, ["llm-vision"]),
      quotesDropped: 0,
      status: "done",
    }),
    findRelatedSuggestions: async () => [],
  },
  redact: {
    // The stub copies bytes unchanged; Stream 2 rebuilds the image.
    image: async (input) => input.bytes,
    text: (input) => {
      const spans = [...input.spans].sort((left, right) => right.start - left.start);
      let content = input.content;

      for (const span of spans) {
        content = `${content.slice(0, span.start)}[REDACTED]${content.slice(span.end)}`;
      }

      return content;
    },
  },
};
