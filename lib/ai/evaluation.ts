import type { Box, Category, FindingCandidate, DetectionMethod } from "@/lib/contract/schemas";

export type EvaluationLabel = { file: string; category: Category; quote?: string; box?: Box };

export type EvaluationScore = {
  layer: DetectionMethod;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
};

// A ground-truth occurrence can match once per layer. Multiple detections of
// the same occurrence cannot inflate recall; extra unmatched hits count as FP.
export function scoreFindings(
  candidates: FindingCandidate[],
  labels: EvaluationLabel[],
): EvaluationScore[] {
  const methods: DetectionMethod[] = [
    "structure",
    "rule",
    "protected-term",
    "ocr-rule",
    "llm-text",
    "llm-vision",
  ];

  const scores: EvaluationScore[] = [];

  for (const layer of methods) {
    const matched = new Set<number>();
    let falsePositive = 0;
    const expected = labels.filter((label) => layer !== "llm-vision" || label.box !== undefined);

    for (const candidate of candidates) {
      for (const detection of candidate.detections) {
        if (detection.method !== layer) continue;

        const index = expected.findIndex((label, position) => {
          if (
            matched.has(position) ||
            candidate.fileId !== label.file ||
            candidate.category !== label.category
          )
            return false;

          return detection.evidence.some((evidence) => {
            if (label.box === undefined)
              return (
                label.quote !== undefined &&
                (evidence.type === "text-span" || evidence.type === "image-region") &&
                evidence.quote === label.quote
              );

            if (evidence.type !== "image-region") return false;
            const left = Math.max(label.box.x, evidence.box.x);
            const top = Math.max(label.box.y, evidence.box.y);
            const right = Math.min(label.box.x + label.box.w, evidence.box.x + evidence.box.w);
            const bottom = Math.min(label.box.y + label.box.h, evidence.box.y + evidence.box.h);
            const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);

            const union =
              label.box.w * label.box.h + evidence.box.w * evidence.box.h - intersection;

            return intersection / union >= 0.5;
          });
        });

        if (index < 0) falsePositive++;
        else matched.add(index);
      }
    }

    const truePositive = matched.size;
    scores.push({
      layer,
      truePositive,
      falsePositive,
      falseNegative: expected.length - truePositive,
      precision:
        truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive),
      recall: expected.length === 0 ? null : truePositive / expected.length,
    });
  }

  return scores;
}
