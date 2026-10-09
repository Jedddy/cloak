import { beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import JSZip from "jszip";

import { fixtureProfiles } from "@/lib/contract/fixtures";
import type { Layers } from "@/lib/contract/interfaces";
import { NO_OPEN_FINDINGS_TEXT, type DocumentModel, type Finding, type Package } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";
import { detectLayer } from "@/lib/detect";
import { documentLayer } from "@/lib/document";
import { redactLayer } from "@/lib/redact";

import { startExport } from "./export";
import { getPackageDetail } from "./packages";
import { workspacePaths } from "./paths";
import { startScan } from "./pipeline";
import { decideFinding, saveRegion } from "./review";
import { addOriginal, createPackage, readCoverage, readDocument, readFindings, readPackage, readVerification, writeProfiles, writeRecipients } from "./store";
import { waitForJob, withTempWorkspace } from "./testing";

// Acceptance examples AE1-AE8 and flows F1-F4 of the document formats plan, run through the functions the routes call,
// on the files in fixtures/documents/ (built by scripts/build-document-fixtures.ts).

withTempWorkspace();

const fixtureDir = join(import.meta.dir, "..", "..", "fixtures", "documents");

/** Real detect/redact/document layers, rules-only; OCR is stubbed because its language data cannot load offline. */
function realLayers(document: Layers["document"] = documentLayer): Layers {
  return {
    ...stubLayers,
    detect: { ...detectLayer, ocr: async () => ({ words: [], lowConfidence: false }) },
    redact: redactLayer,
    document,
    ai: { ...stubLayers.ai, resolveMode: async () => ({ mode: "rules-only", locality: "local", models: { text: null, vision: null } }) },
  };
}

let pkg: Package;

beforeEach(async () => {
  await writeProfiles(fixtureProfiles);
  await writeRecipients([{ id: "recipient-a", name: "Alpha", profileId: "profile-external-contractor", allowRules: [] }]);
});

/** A new package holding the named fixtures, uploaded and scanned. */
async function scanFixtures(names: string[], protectedTerms: string[], layers: Layers) {
  pkg = await createPackage({ name: "Docs", recipientId: "recipient-a", protectedTerms });

  for (const name of names) {
    await addOriginal(pkg.id, { name, bytes: new Uint8Array(await readFile(join(fixtureDir, name))) });
  }

  expect(await waitForJob((await startScan(pkg.id, { confirmRemote: false }, layers)).id)).toBe("done");
}

async function fileId(name: string): Promise<string> {
  const entry = (await readPackage(pkg.id)).files.find((file) => file.originalName === name);

  expect(entry).toBeDefined();

  return entry?.id ?? "";
}

async function findingsOf(name: string): Promise<Finding[]> {
  const id = await fileId(name);

  return (await readFindings(pkg.id)).filter((finding) => finding.fileId === id);
}

async function decideAll(layers: Layers, names?: string[]) {
  const ids = names ? await Promise.all(names.map(fileId)) : null;

  for (const finding of await readFindings(pkg.id)) {
    if (ids === null || ids.includes(finding.fileId)) {
      await decideFinding(pkg.id, finding.id, { decision: "redact", applyToGroup: false }, layers);
    }
  }
}

async function exportAll(layers: Layers) {
  const job = await startExport(pkg.id, { confirmWarnings: true }, layers);

  expect(await waitForJob(job.id)).toBe("done");

  return (await readVerification(pkg.id)) ?? null;
}

async function reviewedBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(workspacePaths.reviewed(pkg.id, name)));
}

async function extractReviewed(name: string, format: DocumentModel["format"]): Promise<DocumentModel> {
  return documentLayer.extract({ fileName: name, format, bytes: await reviewedBytes(name) });
}

/** Every part of a zip as text, by path. */
async function zipTexts(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = new Map<string, string>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) {
      parts.set(path, await entry.async("text"));
    }
  }

  return parts;
}

const hiddenFindings = (findings: Finding[]) =>
  findings.filter((finding) => finding.detections.some((detection) => detection.evidence.some((item) => item.type === "file-structure")));

test("AE1 an encrypted PDF is stored as unsupported with the reason Encrypted PDF", async () => {
  await scanFixtures(["encrypted.pdf"], [], realLayers());

  const [entry] = (await readPackage(pkg.id)).files;

  expect(entry?.kind).toBe("unsupported");
  expect(entry?.status).toBe("unsupported");
  expect(entry?.failureReason).toBe("Encrypted PDF");
});

test("AE2 Acme Corp redacted on page 2 of a PDF is gone from the reviewed copy and verification succeeds", async () => {
  const layers = realLayers();

  await scanFixtures(["brief.pdf"], ["Acme"], layers);

  const acme = (await findingsOf("brief.pdf")).filter((finding) =>
    finding.detections.some((detection) => detection.evidence.some((item) => item.type === "text-span" && /acme/i.test(item.quote))),
  );

  expect(acme.length).toBeGreaterThan(0);

  await decideAll(layers);

  const verification = await exportAll(layers);
  const bytes = await reviewedBytes("brief.pdf");

  expect(await documentLayer.residue({ format: "pdf", bytes, needles: ["Acme Corp", "Acme"] })).toEqual([]);
  expect((await extractReviewed("brief.pdf", "pdf")).text).not.toContain("Acme Corp");
  expect(new TextDecoder("latin1").decode(bytes)).not.toContain("Acme Corp");
  expect(verification?.status).toBe("no-open-findings");
  expect(verification?.text).toBe(NO_OPEN_FINDINGS_TEXT);
});

test("AE3 the Type3 page is flattened alone, the other pages keep their text, and coverage names page 2", async () => {
  const layers = realLayers();

  await scanFixtures(["brief.pdf"], ["Acme"], layers);
  await decideAll(layers);

  const verification = await exportAll(layers);
  const pages = (await extractReviewed("brief.pdf", "pdf")).pages;

  expect(pages.map((page) => page.hasTextLayer)).toEqual([true, false, true]);

  const flattened = verification?.coverage.documentNotes.filter((note) => note.kind === "flattened") ?? [];

  expect(flattened.length).toBeGreaterThan(0);
  expect(flattened.some((note) => /page 2\b/i.test(note.note))).toBe(true);
});

test("AE4 tracked changes and a comment are three hidden findings; removing them leaves no revisions, comments, or J. Cruz", async () => {
  const layers = realLayers();

  await scanFixtures(["proposal.docx"], [], layers);

  const hidden = hiddenFindings(await findingsOf("proposal.docx"));
  const revisions = hidden.filter((finding) => finding.detections.some((detection) => detection.ruleId === "document-revision"));
  const comments = hidden.filter((finding) => finding.detections.some((detection) => detection.ruleId === "document-comment"));

  expect(revisions).toHaveLength(2);
  expect(comments).toHaveLength(1);

  for (const finding of [...revisions, ...comments]) {
    expect(finding.suggestedAction).toBe("redact");
  }

  await decideAll(layers);
  await exportAll(layers);

  const parts = await zipTexts(await reviewedBytes("proposal.docx"));

  expect([...parts.keys()].filter((path) => /comments/i.test(path))).toEqual([]);

  for (const [path, text] of parts) {
    expect(text.includes("J. Cruz")).toBe(false);
    expect(/<w:(ins|del)\b/.test(text)).toBe(false);

    if (path.endsWith("document.xml")) {
      expect(text).toContain("Proposal for the Juniper handoff");
    }
  }
});

test("AE5 an external link in a workbook is a finding, and redacting B4 clears its formula and cached value", async () => {
  const layers = realLayers();

  await scanFixtures(["pricing.xlsx"], [], layers);

  const link = hiddenFindings(await findingsOf("pricing.xlsx")).filter((finding) =>
    finding.detections.some((detection) => detection.ruleId === "document-external-link"),
  );

  expect(link.length).toBeGreaterThan(0);

  // No rule hits the formula cell, so the reviewer selects its text.
  const id = await fileId("pricing.xlsx");
  const model = await readDocument(pkg.id, id);
  const cell = model?.sections.flatMap((section) => section.items).find((item) => item.label === "Rates!B4");

  expect(cell).toBeDefined();
  expect(model?.text.slice(cell?.start, cell?.end)).toContain("ClientX_rates.xlsx");

  await saveRegion(pkg.id, { action: "add-span", fileId: id, start: cell?.start ?? 0, end: cell?.end ?? 1, category: "other" }, layers);
  await decideAll(layers);
  await exportAll(layers);

  const parts = await zipTexts(await reviewedBytes("pricing.xlsx"));
  const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
  const b4 = /<c [^>]*r="B4"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/.exec(sheet)?.[0] ?? "";

  expect(b4).not.toContain("<f");
  expect(b4).not.toContain("1450");
  expect([...parts.values()].some((text) => text.includes("ClientX_rates"))).toBe(false);
  expect((await extractReviewed("pricing.xlsx", "xlsx")).text).not.toContain("1450");
});

test("AE6 a protected term in speaker notes is a finding inside that slide's notes section", async () => {
  await scanFixtures(["deck.pptx"], ["Globex"], realLayers());

  const model = await readDocument(pkg.id, await fileId("deck.pptx"));
  const notes = model?.sections.find((section) => section.title === "Slide 3 notes");

  const spans = (await findingsOf("deck.pptx")).flatMap((finding) =>
    finding.detections.flatMap((detection) => detection.evidence.filter((item) => item.type === "text-span")),
  );

  const inside = spans.find((span) => /globex/i.test(span.quote));

  expect(notes).toBeDefined();
  expect(inside).toBeDefined();
  expect(inside?.start).toBeGreaterThanOrEqual(notes?.items[0]?.start ?? Infinity);
  expect(inside?.end).toBeLessThanOrEqual(notes?.items.at(-1)?.end ?? -1);
});

test("AE7 a SmartArt diagram is listed in coverage as not analysed", async () => {
  await scanFixtures(["proposal.docx"], [], realLayers());

  const notes = (await readCoverage(pkg.id))?.documentNotes ?? [];
  const smartArt = notes.find((note) => note.kind === "not-analysed" && /smartart/i.test(note.note));

  expect(smartArt?.fileId).toBe(await fileId("proposal.docx"));
  expect(smartArt?.note).toContain("not analysed");
});

test("AE8 a redacted string that survives in the reviewed copy fails verification and hides the success text", async () => {
  // A document layer whose redact returns the input unchanged, so "Acme Corp" stays in the copy.
  const layers = realLayers({ ...documentLayer, redact: async (input) => ({ bytes: input.bytes, notes: [] }) });

  await scanFixtures(["brief.pdf"], ["Acme"], layers);
  await decideAll(layers);

  const verification = await exportAll(layers);
  const survivor = verification?.openFindings.find((finding) => finding.title === "Redacted text still present in the reviewed copy");

  expect(verification?.status).toBe("open-findings");
  expect(verification?.text).not.toBe(NO_OPEN_FINDINGS_TEXT);
  expect(survivor?.fileId).toBe(await fileId("brief.pdf"));
  expect((await getPackageDetail(pkg.id)).verification?.text).not.toBe(NO_OPEN_FINDINGS_TEXT);
});

test("F1-F4 a package with a PDF, DOCX, XLSX, and PPTX is scanned, decided, exported, and verified clean", async () => {
  const layers = realLayers();

  await scanFixtures(["brief.pdf", "proposal.docx", "pricing.xlsx", "deck.pptx"], ["Acme", "Globex"], layers);

  const scanNotes = (await readCoverage(pkg.id))?.documentNotes ?? [];

  expect(scanNotes.some((note) => note.kind === "not-analysed")).toBe(true);

  await decideAll(layers);

  const verification = await exportAll(layers);
  const notes = verification?.coverage.documentNotes ?? [];

  expect(verification?.openFindings).toEqual([]);
  expect(verification?.text).toBe(NO_OPEN_FINDINGS_TEXT);
  expect(notes.some((note) => note.kind === "flattened" && /page 2\b/i.test(note.note))).toBe(true);
  expect((await readPackage(pkg.id)).status).toBe("exported");
});
