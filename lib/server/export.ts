import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import JSZip from "jszip";

import { ApiError } from "@/lib/contract/errors";
import type { Layers } from "@/lib/contract/interfaces";
import { documentFormat, hiddenIdOf, pageOfAnchor, RESIDUE_MIN_NEEDLE, type DocumentNote, type ExportStartBody, type FileEntry, type Finding, type Job, type Package } from "@/lib/contract/schemas";

import { containsWord, normalizeText } from "@/lib/utils";

import { findingQuotes } from "./carry";
import { liveJob, startJob, type JobProgress } from "./jobs";
import { logEvent } from "./log";
import { readCurrentPackage, statusBeforeJob } from "./packages";
import { sanitizeExportName, workspacePaths } from "./paths";
import { recipientContext, remoteAllowedInDevelopment } from "./pipeline";
import { readEffectiveSettings } from "./settings";
import {
  deleteVerification,
  readExportManifest,
  readFindings,
  readDocument,
  readOriginal,
  readPackage,
  sha256,
  updatePackage,
  withFindingsLock,
  writeExportManifest,
  writeFindings,
  writeVerification,
  type ExportManifest,
} from "./store";
import { verifyReviewed, type ReviewedCopy } from "./verify";

// Export rebuilds each file through the redactors (Stream 2), writes
// reviewed/ with the original names, proves the originals unchanged, and
// verifies the copies (R20-R23).

/** The comparison key of a quote: trimmed and lowercased (whitespace inside is kept). */
function foldQuote(quote: string): string {
  return quote.trim().toLowerCase();
}

/** Files that get a reviewed copy: not excluded, and analyzed by the last scan. */
function exportable(files: FileEntry[]): FileEntry[] {
  return files.filter((file) => !file.excluded && file.status === "processed");
}

/** A box far larger than any image: the redactors clamp boxes to the image (padBox) or page. */
const WHOLE_BOX = { x: 0, y: 0, w: 1e6, h: 1e6 };

/** True for the anchors of an embedded document image or a document page. */
function wholeAnchor(anchor: string | null | undefined): boolean {
  return Boolean(anchor?.startsWith("image:")) || pageOfAnchor(anchor) !== null;
}

/** A redact decision needs a place to redact: a box on an image, a span in text, or a structure fix. */
function redactable(finding: Finding, file: FileEntry): boolean {
  const evidence = finding.detections.flatMap((detection) => detection.evidence);

  if (file.kind === "document") {
    // Boxes need a page or image anchor (a whole image or page becomes a box over all of it); only hidden items can be removed from the structure.
    return evidence.some(
      (entry) =>
        entry.type === "text-span" ||
        (entry.type === "image-region" && entry.anchor) ||
        (entry.type === "image-whole" && wholeAnchor(entry.anchor)) ||
        hiddenIdOf(entry) !== null,
    );
  }

  const target = file.kind === "image" ? "image-region" : "text-span";

  return evidence.some((entry) => entry.type === target || entry.type === "file-structure");
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";

  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
    candidate = `${stem} (${index})${extension}`;
  }

  used.add(candidate.toLowerCase());

  return candidate;
}

const utf8 = new TextDecoder("utf-8");

async function writeReviewedCopies(pkg: Package, layers: Layers, progress: JobProgress): Promise<ReviewedCopy[]> {
  const packageId = pkg.id;
  const findings = await readFindings(packageId);
  const reviewedDir = workspacePaths.reviewedDir(packageId);
  const used = new Set<string>();
  const manifest: ExportManifest = [];
  const copies: ReviewedCopy[] = [];

  // A file excluded since the last export must not stay in reviewed/.
  await rm(reviewedDir, { recursive: true, force: true });
  await mkdir(reviewedDir, { recursive: true });

  for (const file of exportable(pkg.files)) {
    progress.setFile(file.id, "reading");

    const bytes = await readOriginal(packageId, file);
    const redacted = findings.filter((finding) => finding.fileId === file.id && finding.decision === "redact");

    const evidence = redacted.flatMap((finding) =>
      finding.detections.flatMap((detection) => detection.evidence.map((entry) => ({ entry, category: finding.category }))),
    );

    let output: Uint8Array;
    const needles: string[] = [];
    let notes: DocumentNote[] = [];

    if (file.kind === "document") {
      const model = await readDocument(packageId, file.id);
      const format = documentFormat(file.mime);

      if (model === null || format === null) {
        throw new ApiError("conflict", "Scan the package again before export.");
      }

      const spans = evidence.flatMap(({ entry }) => (entry.type === "text-span" ? [{ start: entry.start, end: entry.end }] : []));

      const regions = evidence.flatMap(({ entry }) => {
        if (entry.type === "image-region" && entry.anchor) {
          return [{ anchor: entry.anchor, box: entry.box }];
        }

        if (entry.type === "image-whole" && wholeAnchor(entry.anchor)) {
          const page = model.pages[(pageOfAnchor(entry.anchor) ?? 0) - 1];

          return [{ anchor: entry.anchor ?? "", box: page ? { x: 0, y: 0, w: page.width, h: page.height } : WHOLE_BOX }];
        }

        return [];
      });

      const removeHidden = evidence.flatMap(({ entry }) => hiddenIdOf(entry) ?? []);

      const result = await layers.document.redact({ fileName: file.originalName, format, bytes, model, spans, regions, removeHidden });

      output = result.bytes;
      notes = result.notes.map((note) => ({ ...note, fileId: file.id }));

      // Text that was approved for removal, minus anything a finding kept in this file.
      const kept = new Set(
        findings
          .filter((finding) => finding.fileId === file.id && finding.decision !== "redact")
          .flatMap((finding) => findingQuotes(finding).map((quote) => foldQuote(quote))),
      );

      // A hidden item's quote is a needle only when the same text is not legitimately visible: for example the
      // display text of an unwrapped hyperlink, or an author also named in the body. Off-page text is part of
      // the extracted text but is removed with the item, so it is always checked. Hidden items are also
      // verified structurally: a survivor is found again by the re-scan under the same `hidden:` anchor.
      let visibleText = "";
      let cursor = 0;

      for (const span of [...spans].sort((a, b) => a.start - b.start)) {
        visibleText += `${model.text.slice(cursor, Math.max(cursor, span.start))} `;
        cursor = Math.max(cursor, span.end);
      }

      const visible = normalizeText(visibleText + model.text.slice(cursor));

      const hiddenQuotes = model.hidden.flatMap((item) => {
        const { quote } = item;

        if (quote === null || !removeHidden.includes(item.id)) {
          return [];
        }

        return item.kind === "off-page-text" || !containsWord(visible, normalizeText(quote)) ? [quote] : [];
      });

      const candidates = [...redacted.flatMap((finding) => findingQuotes(finding)), ...hiddenQuotes];
      const unique = new Map(candidates.map((quote) => [foldQuote(quote), quote.trim()]));

      for (const [key, needle] of unique) {
        if (kept.has(key)) {
          continue;
        }

        if (needle.length < RESIDUE_MIN_NEEDLE) {
          notes.push({ fileId: file.id, kind: "residue-skipped", note: `${file.originalName}: "${needle}" is too short to check in the reviewed copy.` });
          continue;
        }

        needles.push(needle);
      }
    } else if (file.kind === "image") {
      const boxes = evidence.flatMap(({ entry }) => (entry.type === "image-region" ? [entry.box] : []));

      output = await layers.redact.image({ bytes, mime: file.mime, boxes });
    } else {
      const spans = evidence.flatMap(({ entry, category }) =>
        entry.type === "text-span" ? [{ start: entry.start, end: entry.end, category }] : [],
      );

      output = new TextEncoder().encode(layers.redact.text({ fileName: file.originalName, content: utf8.decode(bytes), spans }));
    }

    const name = uniqueName(sanitizeExportName(file.originalName), used);
    const path = workspacePaths.reviewed(packageId, name);

    await writeFile(path, output);
    manifest.push({ fileId: file.id, name });
    copies.push({ file, path, needles, notes });
    progress.setFile(file.id, "done");
  }

  await writeExportManifest(packageId, manifest);

  return copies;
}

/** R21: every original still has the SHA-256 it had at upload. */
async function checkOriginals(pkg: Package): Promise<void> {
  const packageId = pkg.id;

  for (const file of pkg.files) {
    if (sha256(await readOriginal(packageId, file)) !== file.sha256) {
      throw new ApiError("original-changed", `The original file ${file.id} changed after upload.`, [file.id]);
    }
  }
}

async function runExport(packageId: string, layers: Layers, progress: JobProgress): Promise<void> {
  try {
    const pkg = await readPackage(packageId);
    const copies = await writeReviewedCopies(pkg, layers, progress);

    await checkOriginals(pkg);
    const settings = await readEffectiveSettings();
    let resolution = await layers.ai.resolveMode({ settings });

    // Reviewed content goes to a remote model only after the package confirmed it (R16).
    if (resolution.locality === "remote" && !pkg.remoteConfirmed && !remoteAllowedInDevelopment()) {
      resolution = { ...resolution, mode: "rules-only" };
    }

    const { verification, newFindings } = await verifyReviewed({
      ...(await recipientContext(pkg.recipientId)),
      layers,
      settings,
      resolution,
      copies,
      findings: await readFindings(packageId),
      protectedTerms: pkg.protectedTerms,
      progress,
    });

    if (newFindings.length > 0) {
      await withFindingsLock(packageId, async () => writeFindings(packageId, [...(await readFindings(packageId)), ...newFindings]));
    }

    await writeVerification(packageId, verification);
    await updatePackage(packageId, (current) => ({ ...current, status: "exported" }));
    logEvent("export done", { packageId, files: copies.length, openFindings: verification.openFindings.length });
  } catch (error) {
    await updatePackage(packageId, (current) => ({ ...current, status: statusBeforeJob(current) }));

    throw error;
  }
}

/** Starts an export + verification job, or returns the job that already runs for the package. */
export async function startExport(packageId: string, body: ExportStartBody, layers: Layers): Promise<Job> {
  const pkg = await readCurrentPackage(packageId);
  const running = liveJob(packageId);

  if (running !== null) {
    return running;
  }

  if (pkg.status !== "scanned" && pkg.status !== "exported") {
    throw new ApiError("conflict", "Scan the package before export.");
  }

  const findings = await readFindings(packageId);
  const warnings = layers.detect.inconsistentRedactions({ findings, protectedTerms: pkg.protectedTerms, files: pkg.files });

  if (warnings.length > 0 && !body.confirmWarnings) {
    throw new ApiError(
      "warnings-not-confirmed",
      "Some terms are redacted in one file and visible in another. Confirm to export anyway.",
      warnings.map((warning) => warning.message),
    );
  }

  const files = new Map(exportable(pkg.files).map((file) => [file.id, file]));

  const unredactable = findings.flatMap((finding) => {
    const file = files.get(finding.fileId);

    return finding.decision === "redact" && file !== undefined && !redactable(finding, file) ? [finding.id] : [];
  });

  if (unredactable.length > 0) {
    throw new ApiError(
      "unredactable-findings",
      `Draw a box for these findings, or change their decision: ${unredactable.join(", ")}.`,
      unredactable,
    );
  }

  await deleteVerification(packageId);
  await updatePackage(packageId, (current) => ({ ...current, status: "exporting", interrupted: false }));

  return startJob({
    packageId,
    kind: "export",
    fileIds: [...files.keys()],
    run: (progress) => runExport(packageId, layers, progress),
  });
}

/** The zip of reviewed/: only the reviewed copies, never a review report. */
export async function buildZip(packageId: string): Promise<ArrayBuffer> {
  const pkg = await readPackage(packageId);
  const manifest = await readExportManifest(packageId);

  if (pkg.status !== "exported" || manifest.length === 0) {
    throw new ApiError("conflict", "Export the package first.");
  }

  const zip = new JSZip();

  for (const entry of manifest) {
    zip.file(entry.name, await readFile(workspacePaths.reviewed(packageId, entry.name)));
  }

  return zip.generateAsync({ type: "arraybuffer" });
}

/** The reviewed/ name of a file in the last export. */
export async function reviewedName(packageId: string, fileId: string): Promise<string> {
  const entry = (await readExportManifest(packageId)).find((item) => item.fileId === fileId);

  if (entry === undefined) {
    throw new ApiError("not-found", "This file has no reviewed copy.");
  }

  return entry.name;
}
