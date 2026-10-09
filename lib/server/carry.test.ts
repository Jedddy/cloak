import { expect, test } from "bun:test";

import type { Finding, ProfiledCandidate } from "@/lib/contract/schemas";

import { carryDecisions } from "./carry";

function regionCandidate(x: number): ProfiledCandidate {
  return {
    fileId: "file-1",
    category: "personal-contact",
    detections: [
      {
        method: "ocr-rule",
        ruleId: "email",
        evidence: [{ type: "image-region", box: { x, y: 64, w: 210, h: 20 }, quote: "a@b.c" }],
      },
    ],
    title: "Email address",
    reason: "Visible email.",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    relatedGroupId: null,
  };
}

function asFinding(candidate: ProfiledCandidate, decision: Finding["decision"]): Finding {
  return { ...candidate, id: "fnd-old", decision };
}

test("a kept finding stays kept after a rescan finds the same evidence", () => {
  const old = [asFinding(regionCandidate(980), "keep")];
  const [carried] = carryDecisions([regionCandidate(981)], old);

  expect(carried?.decision).toBe("keep");
  expect(carried?.id).toBe("fnd-old");
});

test("a finding whose box moved beyond the 4 px rounding goes back to open", () => {
  const old = [asFinding(regionCandidate(980), "keep")];
  const [carried] = carryDecisions([regionCandidate(992)], old);

  expect(carried?.decision).toBe("open");
  expect(carried?.id).not.toBe("fnd-old");
});

test("an old finding that the rescan does not report is dropped", () => {
  const old = [asFinding(regionCandidate(980), "redact")];

  expect(carryDecisions([], old)).toEqual([]);
});

test("a different category with the same evidence does not take the decision", () => {
  const old = [asFinding(regionCandidate(980), "keep")];
  const [carried] = carryDecisions([{ ...regionCandidate(980), category: "secret" }], old);

  expect(carried?.decision).toBe("open");
});

test("manual findings stay through a rescan", () => {
  const manual: Finding = {
    ...asFinding(regionCandidate(10), "redact"),
    id: "fnd-manual",
    category: "other",
    detections: [
      {
        method: "manual",
        ruleId: null,
        evidence: [{ type: "image-region", box: { x: 0, y: 0, w: 10, h: 10 }, quote: null }],
      },
    ],
  };

  expect(carryDecisions([], [manual])).toEqual([manual]);
});
