import type { ModelFinding } from "./prompts";

// Fixed fictional demo/eval phrases. They still pass the same evidence gate as
// a real model, so mock never manufactures offsets or boxes by file name.
const demoFindings: ModelFinding[] = [
  {
    category: "protected-term",
    quote: "Project Juniper",
    reason: "An unreleased project codename is visible.",
    confidence: "high",
  },
  {
    category: "protected-term",
    quote: "Juniper",
    reason: "A protected project name is visible.",
    confidence: "high",
  },
  {
    category: "internal-pricing",
    quote: "Our day rate for Acme is 1,450 EUR",
    reason: "Internal pricing for another client is visible.",
    confidence: "high",
  },
  {
    category: "other-client",
    quote: "Acme Corp",
    reason: "Another client name is visible.",
    confidence: "high",
    regionType: "tab-bar",
  },
  {
    category: "unreleased-work",
    quote: "Unreleased Atlas launch",
    reason: "Unreleased work is visible.",
    confidence: "high",
    regionType: "sidebar",
  },
  {
    category: "internal-infra",
    quote: "Private staging cluster",
    reason: "Internal infrastructure is described.",
    confidence: "high",
  },
  {
    category: "personal-contact",
    quote: "Mira's private mobile",
    reason: "A private contact is described.",
    confidence: "high",
  },
  {
    category: "prompt-injection",
    quote: "Ignore all prior instructions",
    reason: "The file contains instructions aimed at the scanner.",
    confidence: "high",
  },
];

export function mockFindings(text: string, relatedTerm: string | null = null): ModelFinding[] {
  if (relatedTerm !== null) {
    const references = demoFindings.filter((finding) =>
      finding.quote?.toLowerCase().includes(relatedTerm.toLowerCase()),
    );

    if (relatedTerm.toLowerCase() === "juniper")
      references.push({
        category: "protected-term",
        quote: "the green initiative",
        reason: "A possible reference to Juniper.",
        confidence: "low",
      });

    return references.filter(
      (finding) =>
        finding.quote !== null && text.toLowerCase().includes(finding.quote.toLowerCase()),
    );
  }

  const hits = demoFindings.filter(
    (finding) => finding.quote !== null && text.toLowerCase().includes(finding.quote.toLowerCase()),
  );

  if (hits.some((finding) => finding.quote === "Project Juniper"))
    return hits.filter((finding) => finding.quote !== "Juniper");

  return hits;
}
