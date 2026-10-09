import { describe, expect, test } from "bun:test";

import type { FindingCandidate } from "@/lib/contract/schemas";

import { merge } from "./merge";

function hidden(anchor: string | null): FindingCandidate {
  return {
    fileId: "file-1",
    category: "hidden-data",
    detections: [{ method: "structure", ruleId: "document-revision", evidence: [{ type: "file-structure", note: "Hidden", byteOffset: null, anchor }] }],
    title: "Hidden",
    reason: "Hidden",
    relatedGroupId: null,
  };
}

describe("merge of structure findings", () => {
  test("hidden items with different anchors stay separate findings", () => {
    expect(merge({ candidates: [hidden("hidden:ins-1"), hidden("hidden:ins-2")] })).toHaveLength(2);
  });

  test("structure findings without anchors still join", () => {
    expect(merge({ candidates: [hidden(null), hidden(null)] })).toHaveLength(1);
  });
});
