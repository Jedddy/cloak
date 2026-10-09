import { describe, expect, test } from "bun:test";

import { fixtureProfiles, fixtureRecipients } from "@/lib/contract/fixtures";
import type { Evidence, FindingCandidate } from "@/lib/contract/schemas";

import { merge } from "./merge";
import { profilePresets } from "./presets";
import { applyProfile } from "./profile";

const client = fixtureProfiles.find((profile) => profile.id === "profile-client");

const acme = fixtureRecipients.find((recipient) => recipient.id === "recipient-acme");

function candidate(overrides: Partial<FindingCandidate>): FindingCandidate {
  return {
    fileId: "file-1",
    category: "secret",
    detections: [],
    title: "Title",
    reason: "Reason.",
    relatedGroupId: null,
    ...overrides,
  };
}

describe("applyProfile", () => {
  test("AE1: secrets need a decision while allowed hostnames are kept", () => {
    if (client === undefined || acme === undefined) {
      throw new Error("Missing client fixtures.");
    }

    const profiled = applyProfile({
      candidates: [
        candidate({
          fileId: "file-env",
          category: "secret",
          detections: [
            {
              method: "rule",
              ruleId: "aws-access-key",
              evidence: [{ type: "text-span", start: 0, end: 20, line: 0, quote: "AKIAIOSFODNN7EXAMPLE" }],
            },
          ],
          title: "AWS access key",
        }),
        candidate({
          fileId: "file-notes",
          category: "internal-infra",
          detections: [
            {
              method: "rule",
              ruleId: "internal-hostname",
              evidence: [{ type: "text-span", start: 0, end: 8, line: 0, quote: "acme.dev" }],
            },
          ],
          title: "Internal hostname",
        }),
      ],
      profile: { ...client, remove: client.remove.filter((item) => item !== "secret"), allowed: [...client.allowed, "secret"] },
      recipient: { ...acme, allowRules: [{ id: "allow-1", category: "internal-infra", matchText: "acme.dev", createdAt: "2026-10-09T08:00:00.000Z" }] },
    });

    // The profile would allow secrets, but secrets are never auto-kept.
    expect(profiled[0]?.suggestedAction).toBe("needs-decision");
    expect(profiled[1]?.suggestedAction).toBe("keep");
    expect(profiled[1]?.allowedByRecipient).toBe(true);
  });

  test("remove wins and unknown categories need a decision", () => {
    if (client === undefined || acme === undefined) {
      throw new Error("Missing client fixtures.");
    }

    const profiled = applyProfile({
      candidates: [
        candidate({ category: "secret" }),
        candidate({ category: "unreleased-work" }),
      ],
      profile: client,
      recipient: acme,
    });

    expect(profiled[0]?.suggestedAction).toBe("redact");
    expect(profiled[1]?.suggestedAction).toBe("needs-decision");
  });
});

describe("merge", () => {
  test("AE2: rule and llm detections on the same span become one finding", () => {
    const span: Evidence = { type: "text-span", start: 5, end: 25, line: 0, quote: "jane.doe@example.com" };

    const merged = merge({
      candidates: [
        candidate({
          category: "personal-contact",
          detections: [{ method: "llm-text", ruleId: null, evidence: [span] }],
          title: "Possible email",
          reason: "An llm guess.",
        }),
        candidate({
          category: "personal-contact",
          detections: [{ method: "rule", ruleId: "email", evidence: [span] }],
          title: "Email address",
          reason: "This email address identifies a person.",
        }),
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.detections).toHaveLength(2);
    expect(merged[0]?.title).toBe("Email address");
    expect(merged[0]?.reason).toBe("This email address identifies a person.");
  });

  test("keeps separate findings for different spans and categories", () => {
    const merged = merge({
      candidates: [
        candidate({
          category: "secret",
          detections: [
            { method: "rule", ruleId: "aws-access-key", evidence: [{ type: "text-span", start: 0, end: 4, line: 0, quote: "AKIA" }] },
          ],
        }),
        candidate({
          category: "secret",
          detections: [
            { method: "rule", ruleId: "aws-access-key", evidence: [{ type: "text-span", start: 10, end: 14, line: 0, quote: "AKIA" }] },
          ],
        }),
        candidate({
          category: "personal-contact",
          detections: [
            { method: "rule", ruleId: "email", evidence: [{ type: "text-span", start: 0, end: 4, line: 0, quote: "a@b.cd" }] },
          ],
        }),
      ],
    });

    expect(merged).toHaveLength(3);
  });
});

describe("profilePresets", () => {
  test("exports the three overview presets", () => {
    expect(profilePresets.map((profile) => profile.id).sort()).toEqual([
      "profile-client",
      "profile-external-contractor",
      "profile-public-portfolio",
    ]);
  });
});
