import { beforeEach, expect, test } from "bun:test";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";

import JSZip from "jszip";
import * as mupdf from "mupdf";
import sharp from "sharp";

import { fixtureProfiles } from "@/lib/contract/fixtures";
import type { Layers } from "@/lib/contract/interfaces";
import { NO_OPEN_FINDINGS_TEXT, type Finding, type Package } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";
import { detectLayer } from "@/lib/detect";
import { documentLayer } from "@/lib/document";
import { buildPdf } from "@/lib/document/fixtures/pdf";
import { redactLayer } from "@/lib/redact";

import { buildZip, startExport } from "./export";
import { getJob } from "./jobs";
import { getPackageDetail } from "./packages";
import { workspacePaths } from "./paths";
import { startScan } from "./pipeline";
import { decideFinding, saveRegion } from "./review";
import {
  addOriginal,
  createPackage,
  originalPath,
  readDocument,
  readFindings,
  readPackage,
  sha256,
  updatePackage,
  withFindingsLock,
  writeFindings,
  writeProfiles,
  writeRecipients,
} from "./store";
import { expectApiError, waitForJob, withTempWorkspace } from "./testing";

withTempWorkspace();

const secretPattern = /sk-[a-z0-9-]+/g;

/** Rules-only fake: a rule finds `sk-...` keys in text; no other layer finds anything. */
function fakeLayers(warn = false): Layers {
  return {
    detect: {
      ...stubLayers.detect,
      structure: async () => [],
      protectedTerms: async () => [],
      ocr: async () => ({ words: [], lowConfidence: false }),
      rules: async (input) =>
        [...input.text.matchAll(secretPattern)].map((match) => ({
          fileId: input.fileId,
          category: "secret" as const,
          detections: [
            {
              method: "rule" as const,
              ruleId: "key",
              evidence: [{ type: "text-span" as const, start: match.index, end: match.index + match[0].length, line: 0, quote: match[0] }],
            },
          ],
          title: "Possible access token",
          reason: "r",
          relatedGroupId: null,
        })),
      inconsistentRedactions: (input) =>
        warn
          ? [{ type: "inconsistent-redaction", term: "x", relatedGroupId: null, redactedFileIds: [], visibleFileIds: [], message: "m" }]
          : stubLayers.detect.inconsistentRedactions(input),
    },
    ai: {
      ...stubLayers.ai,
      resolveMode: async () => ({ mode: "rules-only", locality: "local", models: { text: null, vision: null } }),
    },
    redact: stubLayers.redact,
    document: stubLayers.document,
  };
}

let pkg: Package;

beforeEach(async () => {
  await writeProfiles(fixtureProfiles);
  await writeRecipients([{ id: "recipient-a", name: "Alpha", profileId: "profile-external-contractor", allowRules: [] }]);
  pkg = await createPackage({ name: "P", recipientId: "recipient-a", protectedTerms: [] });
  await addOriginal(pkg.id, { name: ".env.example", bytes: new TextEncoder().encode("API_KEY=sk-live-123\n") });
  await addOriginal(pkg.id, { name: "spec.md", bytes: new TextEncoder().encode("# Spec\n") });
  await addOriginal(pkg.id, { name: "../../etc/passwd.txt", bytes: new TextEncoder().encode("root\n") });
});

async function scan(layers: Layers) {
  expect(await waitForJob((await startScan(pkg.id, { confirmRemote: false }, layers)).id)).toBe("done");
}

async function exportPackage(layers: Layers) {
  const job = await startExport(pkg.id, { confirmWarnings: false }, layers);

  await waitForJob(job.id);

  return getJob(job.id);
}

async function redactAll(layers: Layers) {
  for (const finding of await readFindings(pkg.id)) {
    await decideFinding(pkg.id, finding.id, { decision: "redact", applyToGroup: false }, layers);
  }
}

test("export keeps originals unchanged and verification says the required text when nothing is open", async () => {
  const layers = fakeLayers();

  await scan(layers);
  await redactAll(layers);

  const job = await exportPackage(layers);
  const detail = await getPackageDetail(pkg.id);

  expect(job?.status).toBe("done");
  expect(detail.package.status).toBe("exported");
  expect(detail.verification?.text).toBe(NO_OPEN_FINDINGS_TEXT);
  expect(detail.verification?.openFindings).toEqual([]);
  expect(detail.verification?.originalsUnchanged).toBe(true);

  const reviewed = await readFile(workspacePaths.reviewed(pkg.id, ".env.example"), "utf8");

  expect(reviewed).toBe("API_KEY=[REDACTED]\n");
  expect((await readdir(workspacePaths.reviewedDir(pkg.id))).sort()).toEqual([".env.example", "passwd.txt", "spec.md"]);
});

test("an open finding found again on the reviewed copy is listed by verification", async () => {
  const layers = fakeLayers();

  await scan(layers);
  await exportPackage(layers);

  const verification = (await getPackageDetail(pkg.id)).verification;
  const [original] = await readFindings(pkg.id);

  expect(verification?.status).toBe("open-findings");
  expect(verification?.openFindings.map((finding) => finding.id)).toEqual([original?.id ?? ""]);
  expect(verification?.text).not.toBe(NO_OPEN_FINDINGS_TEXT);
});

test("a changed original fails the export with an error that names the file id", async () => {
  const layers = fakeLayers();

  await scan(layers);

  const spec = (await readPackage(pkg.id)).files.find((file) => file.originalName === "spec.md");
  const path = originalPath(pkg.id, spec ?? (await readPackage(pkg.id)).files[0]);

  await chmod(path, 0o644);
  await writeFile(path, "# Changed\n");

  const job = await exportPackage(layers);

  expect(job?.status).toBe("failed");
  expect(job?.error).toContain(spec?.id ?? "missing");
  expect((await readPackage(pkg.id)).status).toBe("scanned");
});

test("an excluded file is not in reviewed/ and not in the zip, and the zip has no report file", async () => {
  const layers = fakeLayers();
  const spec = (await readPackage(pkg.id)).files.find((file) => file.originalName === "spec.md");

  await scan(layers);
  await updatePackage(pkg.id, (current) => ({
    ...current,
    files: current.files.map((file) => (file.id === spec?.id ? { ...file, excluded: true } : file)),
  }));
  await redactAll(layers);
  await exportPackage(layers);

  const zip = await JSZip.loadAsync(await buildZip(pkg.id));
  const names = Object.keys(zip.files).sort();

  expect(names).toEqual([".env.example", "passwd.txt"]);
  expect(await readdir(workspacePaths.reviewedDir(pkg.id))).not.toContain("spec.md");
});

test("export with warnings and no confirmWarnings is rejected", async () => {
  const layers = fakeLayers(true);

  await scan(layers);
  await expectApiError(startExport(pkg.id, { confirmWarnings: false }, layers), "warnings-not-confirmed");

  const job = await startExport(pkg.id, { confirmWarnings: true }, layers);

  expect(await waitForJob(job.id)).toBe("done");
});

test("a redact finding with only image-whole evidence blocks export until a box is drawn", async () => {
  const layers = fakeLayers();
  const image = await addOriginal(pkg.id, { name: "shot.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });

  await scan(layers);

  const whole: Finding = {
    id: "fnd-whole",
    fileId: image.id,
    category: "unreleased-work",
    detections: [{ method: "llm-vision", ruleId: null, evidence: [{ type: "image-whole", note: "Sidebar." }] }],
    title: "t",
    reason: "r",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [...(await readFindings(pkg.id)), whole]));

  const blocked = startExport(pkg.id, { confirmWarnings: false }, layers);

  await expectApiError(blocked, "unredactable-findings");
  await expect(startExport(pkg.id, { confirmWarnings: false }, layers)).rejects.toThrow(/fnd-whole/);

  await saveRegion(pkg.id, { action: "update", findingId: "fnd-whole", box: { x: 0, y: 0, w: 40, h: 300 } }, layers);

  const job = await startExport(pkg.id, { confirmWarnings: false }, layers);

  expect(await waitForJob(job.id)).toBe("done");
});

// ---------------------------------------------------------------------------
// Documents (U8)
// ---------------------------------------------------------------------------

/** Real detect/redact/document layers, rules-only, no OCR (language data is not available offline). `residue` can be replaced to spy on the check. */
function documentLayers(residue?: Layers["document"]["residue"]): Layers {
  return {
    ...stubLayers,
    detect: { ...detectLayer, ocr: async () => ({ words: [], lowConfidence: false }) },
    redact: redactLayer,
    document: residue ? { ...documentLayer, residue } : documentLayer,
    ai: { ...stubLayers.ai, resolveMode: async () => ({ mode: "rules-only", locality: "local", models: { text: null, vision: null } }) },
  };
}

const pdfLines = ["Contract with Acme Corp", "Signed by J. Cruz"];

/** A fresh package holding only the given files, scanned with the real layers. */
async function scanDocuments(files: { name: string; bytes: Uint8Array }[], layers: Layers) {
  pkg = await createPackage({ name: "D", recipientId: "recipient-a", protectedTerms: ["Acme"] });

  for (const file of files) {
    await addOriginal(pkg.id, file);
  }

  await scan(layers);
}

async function verification() {
  return (await getPackageDetail(pkg.id)).verification;
}

test("AE8: a needle still in the reviewed copy opens a finding on the original file, not the success text", async () => {
  const seen: string[][] = [];

  const layers = documentLayers(async (input) => {
    seen.push(input.needles);

    return ["Acme Corp"];
  });

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);
  await redactAll(layers);
  await exportPackage(layers);

  const result = await verification();
  const open = result?.openFindings.find((finding) => finding.title === "Redacted text still present in the reviewed copy");

  expect(seen[0]?.length).toBeGreaterThan(0);
  expect(result?.status).toBe("open-findings");
  expect(result?.text).not.toBe(NO_OPEN_FINDINGS_TEXT);
  expect(open?.fileId).toBe((await readPackage(pkg.id)).files[0]?.id ?? "missing");
  expect(open?.decision).toBe("open");
  expect(open?.suggestedAction).toBe("needs-decision");
});

test("F3/F4: a protected term decided redact is gone from the reviewed PDF and verification is clean", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);
  await redactAll(layers);
  await exportPackage(layers);

  const reviewed = new Uint8Array(await readFile(workspacePaths.reviewed(pkg.id, "a.pdf")));

  expect((await verification())?.text).toBe(NO_OPEN_FINDINGS_TEXT);
  expect(await documentLayer.residue({ format: "pdf", bytes: reviewed, needles: ["Acme"] })).toEqual([]);
  expect((await documentLayer.extract({ fileName: "a.pdf", format: "pdf", bytes: reviewed })).text).not.toContain("Acme");
});

test("a Type3 page redaction puts a flattened note in the verification coverage", async () => {
  const layers = documentLayers();
  const bytes = buildPdf({ pages: [{ type3: true, lines: ["abab"], image: true }] });

  await scanDocuments([{ name: "t.pdf", bytes }], layers);

  const [file] = (await readPackage(pkg.id)).files;
  const model = await readDocument(pkg.id, file?.id ?? "");

  expect(model?.pages[0]?.type3).toBe(true);

  const finding: Finding = {
    id: "fnd-t3",
    fileId: file?.id ?? "",
    category: "other",
    detections: [{ method: "manual", ruleId: null, evidence: [{ type: "text-span", start: 0, end: 4, line: 0, quote: "abab" }] }],
    title: "t",
    reason: "r",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [finding]));
  await exportPackage(layers);

  expect((await verification())?.coverage.documentNotes.map((note) => note.kind)).toContain("flattened");
});

test("a 2-character needle is skipped with a note and opens no finding", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);

  const [file] = (await readPackage(pkg.id)).files;
  const model = await readDocument(pkg.id, file?.id ?? "");
  const start = model?.text.indexOf("J.") ?? -1;

  expect(start).toBeGreaterThan(-1);

  const finding: Finding = {
    id: "fnd-short",
    fileId: file?.id ?? "",
    category: "other",
    detections: [{ method: "manual", ruleId: null, evidence: [{ type: "text-span", start, end: start + 2, line: 0, quote: "J." }] }],
    title: "t",
    reason: "r",
    suggestedAction: "redact",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [finding]));
  await exportPackage(layers);

  const result = await verification();

  expect(result?.coverage.documentNotes).toContainEqual({
    fileId: file?.id ?? "",
    kind: "residue-skipped",
    note: 'a.pdf: "J." is too short to check in the reviewed copy.',
  });
  expect(result?.openFindings.some((entry) => entry.title === "Redacted text still present in the reviewed copy")).toBe(false);
});

test("a finding decided keep is not a needle: its text stays in the copy and verification succeeds", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);

  for (const finding of await readFindings(pkg.id)) {
    await decideFinding(pkg.id, finding.id, { decision: "keep", applyToGroup: false }, layers);
  }

  await exportPackage(layers);

  const reviewed = new Uint8Array(await readFile(workspacePaths.reviewed(pkg.id, "a.pdf")));

  expect((await verification())?.text).toBe(NO_OPEN_FINDINGS_TEXT);
  expect(await documentLayer.residue({ format: "pdf", bytes: reviewed, needles: ["Acme"] })).toEqual(["Acme"]);
});

test("images and text exported next to a document have the same bytes as exported alone", async () => {
  const layers = documentLayers();
  const png = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#888" } }).png().toBuffer());

  const others = [
    { name: "notes.txt", bytes: new TextEncoder().encode("Acme plans\n") },
    { name: "shot.png", bytes: png },
  ];

  const exportFiles = async (files: { name: string; bytes: Uint8Array }[]) => {
    await scanDocuments(files, layers);
    await redactAll(layers);
    await exportPackage(layers);

    return Promise.all(others.map(async (file) => readFile(workspacePaths.reviewed(pkg.id, file.name))));
  };

  const alone = await exportFiles(others);
  const together = await exportFiles([...others, { name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }]);

  expect(alone[0]?.toString()).toBe("[REDACTED] plans\n");
  expect(together.map((buffer) => buffer.toString("hex"))).toEqual(alone.map((buffer) => buffer.toString("hex")));
});

test("the originals keep their SHA-256 after a document export", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);
  await redactAll(layers);
  await exportPackage(layers);

  const current = await readPackage(pkg.id);

  for (const file of current.files) {
    expect(sha256(await readFile(originalPath(pkg.id, file)))).toBe(file.sha256);
  }

  expect((await verification())?.originalsUnchanged).toBe(true);
});

test("a document finding with only image-whole evidence blocks export; a hidden: anchor does not", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);

  const [file] = (await readPackage(pkg.id)).files;

  const finding: Finding = {
    id: "fnd-doc",
    fileId: file?.id ?? "",
    category: "hidden-data",
    detections: [{ method: "llm-vision", ruleId: null, evidence: [{ type: "image-whole", note: "Picture." }] }],
    title: "t",
    reason: "r",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [finding]));
  await expectApiError(startExport(pkg.id, { confirmWarnings: false }, layers), "unredactable-findings");

  const hidden: Finding = {
    ...finding,
    detections: [
      { method: "structure", ruleId: "document-metadata", evidence: [{ type: "file-structure", note: "n", byteOffset: null, anchor: "hidden:x" }] },
    ],
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [hidden]));

  const job = await startExport(pkg.id, { confirmWarnings: false }, layers);

  expect(await waitForJob(job.id)).toBe("done");
});

/** A one-page PDF with a sticky note by `author` and the given body lines, scanned; returns the hidden-item findings. */
async function scanNotePdf(author: string, lines: string[], layers: Layers) {
  await scanDocuments([{ name: "n.pdf", bytes: buildPdf({ pages: [{ lines, note: { author, contents: "Check the price" } }] }) }], layers);

  const findings = await readFindings(pkg.id);
  const hidden = findings.filter((finding) => finding.detections.some((detection) => detection.evidence.some((entry) => entry.type === "file-structure" && entry.anchor?.startsWith("hidden:"))));

  expect(hidden.length).toBeGreaterThan(0);

  return { findings, hidden };
}

test("a removed hidden item whose quote is also visible text is not a residue needle", async () => {
  const layers = documentLayers();
  const { findings } = await scanNotePdf("J. Cruz", ["Signed by J. Cruz"], layers);

  for (const finding of findings) {
    const isNote = finding.title.startsWith("Comment by");

    await decideFinding(pkg.id, finding.id, { decision: isNote ? "redact" : "keep", applyToGroup: false }, layers);
  }

  await exportPackage(layers);

  const result = await verification();

  expect(result?.openFindings).toEqual([]);
  expect(result?.text).toBe(NO_OPEN_FINDINGS_TEXT);
});

test("a hidden item that survives removal is an open finding on the original", async () => {
  const layers = documentLayers();
  const ignoring: Layers = { ...layers, document: { ...layers.document, redact: (input) => layers.document.redact({ ...input, removeHidden: [] }) } };
  const { findings, hidden } = await scanNotePdf("Zed Quux", ["Signed by someone"], layers);

  for (const finding of findings) {
    await decideFinding(pkg.id, finding.id, { decision: hidden.includes(finding) ? "redact" : "keep", applyToGroup: false }, layers);
  }

  await exportPackage(ignoring);

  const result = await verification();
  const note = hidden.find((finding) => finding.title.startsWith("Comment by"));

  expect(result?.status).toBe("open-findings");
  expect(result?.openFindings.map((finding) => finding.id)).toContain(note?.id ?? "missing");
});

test("a document finding with image-whole evidence and a page anchor is redacted over the whole page", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines, image: true }] }) }], layers);

  const [file] = (await readPackage(pkg.id)).files;

  const finding: Finding = {
    id: "fnd-page",
    fileId: file?.id ?? "",
    category: "unreleased-work",
    detections: [{ method: "llm-vision", ruleId: null, evidence: [{ type: "image-whole", note: "Picture.", anchor: "page:1" }] }],
    title: "t",
    reason: "r",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [finding]));

  const job = await startExport(pkg.id, { confirmWarnings: false }, layers);

  expect(await waitForJob(job.id)).toBe("done");

  const reviewed = new Uint8Array(await readFile(workspacePaths.reviewed(pkg.id, "a.pdf")));
  const doc = new mupdf.PDFDocument(reviewed);
  const page = doc.loadPage(0);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false, true);
  const lightest = Math.max(...pixmap.getPixels());

  expect(page.toStructuredText("preserve-whitespace").asText().trim()).toBe("");
  expect(lightest).toBe(0);
  doc.destroy();
});

test("a document finding with image-whole evidence and an image anchor can be exported", async () => {
  const layers = documentLayers();

  await scanDocuments([{ name: "a.pdf", bytes: buildPdf({ pages: [{ lines: pdfLines }] }) }], layers);

  const [file] = (await readPackage(pkg.id)).files;

  const finding: Finding = {
    id: "fnd-image",
    fileId: file?.id ?? "",
    category: "unreleased-work",
    detections: [{ method: "llm-vision", ruleId: null, evidence: [{ type: "image-whole", note: "Picture.", anchor: "image:word/media/image1.png" }] }],
    title: "t",
    reason: "r",
    suggestedAction: "needs-decision",
    allowedByRecipient: false,
    decision: "redact",
    relatedGroupId: null,
  };

  await withFindingsLock(pkg.id, async () => writeFindings(pkg.id, [finding]));

  const job = await startExport(pkg.id, { confirmWarnings: false }, layers);

  expect(await waitForJob(job.id)).toBe("done");
});
