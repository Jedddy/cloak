import type { ApplyProfileInput } from "@/lib/contract/interfaces";
import type { FindingCandidate, ProfiledCandidate } from "@/lib/contract/schemas";

import { hasQuote } from "./evidence";

// Profile application (overview section 11, plan R15). suggestedAction
// comes from the profile buckets and the recipient's allow rules. Rule
// findings in category secret are never auto-kept.

function allowedByRule(candidate: FindingCandidate, matchText: string): boolean {
  return hasQuote(candidate.detections, matchText);
}

export function applyProfile(input: ApplyProfileInput): ProfiledCandidate[] {
  return input.candidates.map((candidate) => {
    const allowed = input.recipient.allowRules.some(
      (rule) => rule.category === candidate.category && allowedByRule(candidate, rule.matchText),
    );

    if (allowed) {
      return { ...candidate, suggestedAction: "keep", allowedByRecipient: true };
    }

    if (input.profile.remove.includes(candidate.category)) {
      return { ...candidate, suggestedAction: "redact", allowedByRecipient: false };
    }

    if (input.profile.allowed.includes(candidate.category)) {
      // A secret is never auto-kept by a profile (overview section 11).
      if (candidate.category === "secret") {
        return { ...candidate, suggestedAction: "needs-decision", allowedByRecipient: false };
      }

      return { ...candidate, suggestedAction: "keep", allowedByRecipient: false };
    }

    return { ...candidate, suggestedAction: "needs-decision", allowedByRecipient: false };
  });
}
