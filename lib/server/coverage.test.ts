import { expect, test } from "bun:test";

import { fixtureFiles, fixtureFindings } from "@/lib/contract/fixtures";
import type { FileEntry, Finding } from "@/lib/contract/schemas";

import { buildCoverage } from "./coverage";

const base = {
  quotesDropped: 0,
  lowConfidenceFileIds: [],
  mode: "full" as const,
  locality: "lan" as const,
  models: { text: "t", vision: "v" },
  modeFallback: null,
};

test("findingsOpen counts only open findings on files that are not excluded", () => {
  const files: FileEntry[] = fixtureFiles.map((file) =>
    file.originalName === "notes.md" ? { ...file, excluded: true } : file,
  );

  const findings: Finding[] = fixtureFindings;
  const coverage = buildCoverage({ ...base, files, findings });

  const expected = findings.filter((finding) => {
    const file = files.find((entry) => entry.id === finding.fileId);

    return finding.decision === "open" && file?.excluded === false;
  }).length;

  expect(coverage.findingsOpen).toBe(expected);
  expect(coverage.findingsOpen).toBe(6);
  expect(coverage.filesExcluded).toEqual(["file-notes"]);
});

test("coverage lists failed, unsupported, and no-AI files with reasons", () => {
  const files: FileEntry[] = [
    { ...fixtureFiles[0], id: "a", status: "processed", aiAnalysis: "done" },
    { ...fixtureFiles[0], id: "b", status: "processed", aiAnalysis: "failed" },
    { ...fixtureFiles[0], id: "c", status: "failed", failureReason: "Cannot read." },
    { ...fixtureFiles[0], id: "d", kind: "unsupported", status: "unsupported" },
  ];

  const coverage = buildCoverage({ ...base, files, findings: [] });

  expect(coverage.filesTotal).toBe(4);
  expect(coverage.filesProcessed).toBe(2);
  expect(coverage.filesFailed).toEqual([{ fileId: "c", reason: "Cannot read." }]);
  expect(coverage.filesUnsupported).toEqual(["d"]);
  expect(coverage.filesWithoutAi.map((entry) => entry.fileId)).toEqual(["b"]);
});
