import { beforeEach, describe, expect, test } from "bun:test";

import { fixtureProfiles } from "@/lib/contract/fixtures";
import type { Layers } from "@/lib/contract/interfaces";
import type { Finding, FindingCandidate, Package, PackageWarning, Recipient } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";
import { documentLayer } from "@/lib/document";
import { buildPdf } from "@/lib/document/fixtures/pdf";
import { buildXlsx } from "@/lib/document/fixtures/ooxml";

import { decideFinding, findRelated, saveRegion } from "./review";
import { expectApiError } from "./testing";
import { addOriginal, createPackage, readFindings, readRecipients, updatePackage, writeDocument, writeFindings, writeProfiles, writeRecipients, writeOcr } from "./store";
import { withTempWorkspace } from "./testing";

withTempWorkspace();

const recipients: Recipient[] = [
  { id: "recipient-a", name: "Alpha Ltd", profileId: "profile-client", allowRules: [] },
  { id: "recipient-b", name: "Beta Ltd", profileId: "profile-client", allowRules: [] },
];

let pkg: Package;

let notesId = "";

let shotId = "";

function finding(id: string, fileId: string, category: Finding["category"], quote: string, relatedGroupId: string | null = null): Finding {
  return {
    id,
    fileId,
    category,
    detections: [{ method: "rule", ruleId: null, evidence: [{ type: "text-span", start: 0, end: quote.length, line: 0, quote }] }],
    title: "t",
    reason: "r",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "open",
    relatedGroupId,
  };
}

/** Stub layers with a package check that warns on a group with one redact and one open occurrence. */
const layers: Layers = {
  ...stubLayers,
  detect: {
    ...stubLayers.detect,
    inconsistentRedactions: (input) => {
      const warnings: PackageWarning[] = [];
      const groups = new Set(input.findings.flatMap((entry) => (entry.relatedGroupId === null ? [] : [entry.relatedGroupId])));

      for (const group of groups) {
        const members = input.findings.filter((entry) => entry.relatedGroupId === group);
        const redacted = members.filter((entry) => entry.decision === "redact");
        const visible = members.filter((entry) => entry.decision === "open" || entry.decision === "keep");

        if (redacted.length > 0 && visible.length > 0) {
          warnings.push({
            type: "inconsistent-redaction",
            term: group,
            relatedGroupId: group,
            redactedFileIds: redacted.map((entry) => entry.fileId),
            visibleFileIds: visible.map((entry) => entry.fileId),
            message: "inconsistent",
          });
        }
      }

      return warnings;
    },
  },
};

beforeEach(async () => {
  await writeProfiles(fixtureProfiles);
  await writeRecipients(recipients);
  pkg = await createPackage({ name: "P", recipientId: "recipient-a", protectedTerms: ["Juniper"] });
  notesId = (await addOriginal(pkg.id, { name: "notes.md", bytes: new TextEncoder().encode("Project Juniper ships in May.\n") })).id;
  shotId = (await addOriginal(pkg.id, { name: "shot.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).id;
});

describe("decisions", () => {
  test("keep-and-remember on a personal-contact finding adds one allow rule; a second call adds none", async () => {
    await writeFindings(pkg.id, [finding("f1", notesId, "personal-contact", "jane@example.com")]);

    await decideFinding(pkg.id, "f1", { decision: "keep-and-remember", applyToGroup: false }, layers);
    await decideFinding(pkg.id, "f1", { decision: "keep-and-remember", applyToGroup: false }, layers);

    const [alpha, beta] = await readRecipients();

    expect(alpha?.allowRules.map((rule) => [rule.category, rule.matchText])).toEqual([["personal-contact", "jane@example.com"]]);
    expect(beta?.allowRules).toEqual([]);
    expect((await readFindings(pkg.id))[0]?.decision).toBe("keep-and-remember");
  });

  test("keep-and-remember on a secret saves the decision and adds no allow rule", async () => {
    await writeFindings(pkg.id, [finding("f1", notesId, "secret", "sk-test")]);

    await decideFinding(pkg.id, "f1", { decision: "keep-and-remember", applyToGroup: false }, layers);

    expect((await readRecipients())[0]?.allowRules).toEqual([]);
    expect((await readFindings(pkg.id))[0]?.decision).toBe("keep-and-remember");
  });

  test("redacting one occurrence while another is open returns the warning for both files", async () => {
    await writeFindings(pkg.id, [
      finding("f1", notesId, "protected-term", "Juniper", "rel-juniper"),
      finding("f2", shotId, "protected-term", "Juniper", "rel-juniper"),
    ]);

    const result = await decideFinding(pkg.id, "f1", { decision: "redact", applyToGroup: false }, layers);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.redactedFileIds).toEqual([notesId]);
    expect(result.warnings[0]?.visibleFileIds).toEqual([shotId]);
  });

  test("a group decision applies to every finding with the same relatedGroupId", async () => {
    await writeFindings(pkg.id, [
      finding("f1", notesId, "protected-term", "Juniper", "rel-juniper"),
      finding("f2", shotId, "protected-term", "Juniper", "rel-juniper"),
      finding("f3", shotId, "secret", "sk-test"),
    ]);

    const result = await decideFinding(pkg.id, "f1", { decision: "redact", applyToGroup: true }, layers);

    expect(result.findings.map((entry) => entry.id)).toEqual(["f1", "f2"]);
    expect((await readFindings(pkg.id)).map((entry) => entry.decision)).toEqual(["redact", "redact", "open"]);
    expect(result.warnings).toEqual([]);
  });

  test("an allow rule on recipient A is not passed to the profile for a package of recipient B", async () => {
    await writeFindings(pkg.id, [finding("f1", notesId, "personal-contact", "jane@example.com")]);
    await decideFinding(pkg.id, "f1", { decision: "keep-and-remember", applyToGroup: false }, layers);

    const other = await createPackage({ name: "Q", recipientId: "recipient-b", protectedTerms: [] });
    const seen: Recipient[] = [];

    const recording: Layers = {
      ...layers,
      detect: {
        ...layers.detect,
        applyProfile: (input) => {
          seen.push(input.recipient);

          return layers.detect.applyProfile(input);
        },
      },
    };

    await findRelated(other.id, { term: "jane" }, recording);

    expect(seen.every((recipient) => recipient.id === "recipient-b" && recipient.allowRules.length === 0)).toBe(true);
  });
});

describe("regions", () => {
  test("a manual region creates a finding with one manual detection, category other, and image-region evidence", async () => {
    const result = await saveRegion(pkg.id, { action: "add", fileId: shotId, box: { x: 1, y: 2, w: 30, h: 10 }, category: "other" }, layers);
    const [created] = result.findings;

    expect(created?.category).toBe("other");
    expect(created?.decision).toBe("redact");
    expect(created?.detections).toEqual([
      { method: "manual", ruleId: null, evidence: [{ type: "image-region", box: { x: 1, y: 2, w: 30, h: 10 }, quote: null }] },
    ]);
    expect(await readFindings(pkg.id)).toHaveLength(1);
  });

  test("deleting a manual region removes its finding", async () => {
    const added = await saveRegion(pkg.id, { action: "add", fileId: shotId, box: { x: 1, y: 2, w: 30, h: 10 }, category: "other" }, layers);

    await saveRegion(pkg.id, { action: "delete", findingId: added.findings[0]?.id ?? "" }, layers);

    expect(await readFindings(pkg.id)).toEqual([]);
  });

  test("a box set on an image-whole finding becomes its manual detection", async () => {
    const whole: Finding = {
      ...finding("f-whole", shotId, "unreleased-work", ""),
      detections: [{ method: "llm-vision", ruleId: null, evidence: [{ type: "image-whole", note: "Sidebar." }] }],
    };

    await writeFindings(pkg.id, [whole]);

    const result = await saveRegion(pkg.id, { action: "update", findingId: "f-whole", box: { x: 0, y: 0, w: 50, h: 400 } }, layers);

    expect(result.findings[0]?.detections.map((detection) => detection.method)).toEqual(["llm-vision", "manual"]);
  });

  test("a region on a text file is rejected", async () => {
    const response = saveRegion(pkg.id, { action: "add", fileId: notesId, box: { x: 1, y: 2, w: 3, h: 4 }, category: "other" }, layers);

    await expect(response).rejects.toThrow();
  });
});

describe("document selections", () => {
  let sheetId = "";
  let pdfId = "";
  let text = "";

  beforeEach(async () => {
    const xlsx = await buildXlsx({ sheets: [{ name: "Summary", cells: { A1: { text: "Quarterly figures" }, A2: { text: "Secret margin" } } }] });
    const pdf = buildPdf({ pages: [{ lines: ["one"] }, { lines: ["two"] }] });

    sheetId = (await addOriginal(pkg.id, { name: "book.xlsx", bytes: xlsx })).id;
    pdfId = (await addOriginal(pkg.id, { name: "deck.pdf", bytes: pdf })).id;

    const model = await documentLayer.extract({ fileName: "book.xlsx", format: "xlsx", bytes: xlsx });

    text = model.text;
    await writeDocument(pkg.id, sheetId, model);
    await writeDocument(pkg.id, pdfId, await documentLayer.extract({ fileName: "deck.pdf", format: "pdf", bytes: pdf }));
  });

  test("add-span creates an open manual finding with the quote and line of the range", async () => {
    const start = text.indexOf("Secret margin");
    const body = { action: "add-span", fileId: sheetId, start, end: start + 6, category: "internal-pricing" } as const;
    const [created] = (await saveRegion(pkg.id, body, layers)).findings;

    expect(created?.decision).toBe("open");
    expect(created?.suggestedAction).toBe("redact");
    expect(created?.category).toBe("internal-pricing");
    expect(created?.detections).toEqual([
      { method: "manual", ruleId: null, evidence: [{ type: "text-span", start, end: start + 6, line: 1, quote: "Secret" }] },
    ]);
    expect(await readFindings(pkg.id)).toHaveLength(1);
  });

  test("add-span rejects a range outside the text, an empty range, and a document with no model", async () => {
    const add = (start: number, end: number, fileId = sheetId) => saveRegion(pkg.id, { action: "add-span", fileId, start, end, category: "other" }, layers);
    const pdfOnly = (await addOriginal(pkg.id, { name: "x.pdf", bytes: buildPdf({ pages: [{ lines: ["x"] }] }) })).id;

    await expectApiError(add(0, text.length + 1), "bad-request");
    await expectApiError(add(5, 5), "bad-request");
    await expectApiError(add(0, 1, pdfOnly), "conflict");
    expect(await readFindings(pkg.id)).toEqual([]);
  });

  test("add-span on an image or a text file is rejected", async () => {
    await expectApiError(saveRegion(pkg.id, { action: "add-span", fileId: shotId, start: 0, end: 1, category: "other" }, layers), "bad-request");
    await expectApiError(saveRegion(pkg.id, { action: "add-span", fileId: notesId, start: 0, end: 1, category: "other" }, layers), "bad-request");
  });

  test("a box on a PDF needs a page anchor inside the document and keeps it on the evidence", async () => {
    const box = { x: 1, y: 2, w: 30, h: 10 };
    const add = (anchor?: string) => saveRegion(pkg.id, { action: "add", fileId: pdfId, box, anchor, category: "other" }, layers);

    await expectApiError(add(), "bad-request");
    await expectApiError(add("page:3"), "bad-request");
    await expectApiError(add("page:0"), "bad-request");
    await expectApiError(add("image:x"), "bad-request");

    const [created] = (await add("page:2")).findings;

    expect(created?.detections[0]?.evidence).toEqual([{ type: "image-region", box, quote: null, anchor: "page:2" }]);
  });

  test("update on a document finding needs a valid page anchor", async () => {
    const box = { x: 1, y: 2, w: 30, h: 10 };
    const [created] = (await saveRegion(pkg.id, { action: "add", fileId: pdfId, box, anchor: "page:1", category: "other" }, layers)).findings;
    const findingId = created?.id ?? "";
    const moved = { x: 5, y: 6, w: 7, h: 8 };

    await expectApiError(saveRegion(pkg.id, { action: "update", findingId, box: moved }, layers), "bad-request");
    await expectApiError(saveRegion(pkg.id, { action: "update", findingId, box: moved, anchor: "page:9" }, layers), "bad-request");

    const [updated] = (await saveRegion(pkg.id, { action: "update", findingId, box: moved, anchor: "page:2" }, layers)).findings;

    expect(updated?.detections[0]?.evidence).toEqual([{ type: "image-region", box: moved, quote: null, anchor: "page:2" }]);
  });

  test("a box on an Office document is rejected for lack of a page", async () => {
    const box = { x: 1, y: 2, w: 30, h: 10 };

    await expectApiError(saveRegion(pkg.id, { action: "add", fileId: sheetId, box, anchor: "page:1", category: "other" }, layers), "bad-request");
  });
});

describe("related", () => {
  function exactLayers(calls: string[]): Layers {
    const hit = (fileId: string): FindingCandidate => ({
      fileId,
      category: "protected-term",
      detections: [{ method: "protected-term", ruleId: null, evidence: [{ type: "text-span", start: 8, end: 15, line: 0, quote: "Juniper" }] }],
      title: "Juniper",
      reason: "r",
      relatedGroupId: null,
    });

    return {
      ...layers,
      detect: {
        ...layers.detect,
        findRelatedExact: async (input) => {
          calls.push(`exact:${input.sources.map((source) => source.fileName).join(",")}`);

          return input.sources.map((source) => hit(source.fileId));
        },
      },
      ai: {
        ...layers.ai,
        findRelatedSuggestions: async () => {
          calls.push("ai");

          return [];
        },
      },
    };
  }

  test("in rules-only mode related returns exact matches only and asks no AI", async () => {
    await updatePackage(pkg.id, (current) => ({
      ...current,
      lastScan: { mode: "rules-only", locality: "local", models: { text: null, vision: null }, startedAt: new Date().toISOString(), finishedAt: null },
    }));

    await writeOcr(pkg.id, shotId, { lowConfidence: false, words: [{ text: "Juniper", box: { x: 0, y: 0, w: 9, h: 9 }, confidence: 90, line: 0 }] });

    const calls: string[] = [];
    const result = await findRelated(pkg.id, { term: "Juniper" }, exactLayers(calls));

    expect(calls).toEqual(["exact:notes.md,shot.png"]);
    expect(result.exact).toHaveLength(2);
    expect(result.aiSuggestions).toEqual([]);
    expect(result.exact.every((entry) => entry.relatedGroupId === result.relatedGroupId)).toBe(true);
  });

  test("in full mode related also asks the AI layer, and an existing finding joins the group", async () => {
    await updatePackage(pkg.id, (current) => ({
      ...current,
      lastScan: { mode: "full", locality: "local", models: { text: "t", vision: "v" }, startedAt: new Date().toISOString(), finishedAt: null },
    }));

    const existing: Finding = {
      ...finding("f-existing", notesId, "protected-term", "Juniper"),
      detections: [{ method: "protected-term", ruleId: null, evidence: [{ type: "text-span", start: 8, end: 15, line: 0, quote: "Juniper" }] }],
    };

    await writeFindings(pkg.id, [existing]);

    const calls: string[] = [];
    const result = await findRelated(pkg.id, { term: "Juniper" }, exactLayers(calls));

    expect(calls).toContain("ai");
    expect(result.exact.map((entry) => entry.id)).toEqual(["f-existing"]);
    expect((await readFindings(pkg.id))[0]?.relatedGroupId).toBe(result.relatedGroupId);
  });
});
