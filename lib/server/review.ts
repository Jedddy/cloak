import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/contract/errors";
import type { Layers, RelatedSource } from "@/lib/contract/interfaces";
import {
  pageOfAnchor,
  type AllowRule,
  type DocumentModel,
  type Detection,
  type FileEntry,
  type Finding,
  type FindingCandidate,
  type FindingDecisionBody,
  type FindingDecisionResult,
  type Package,
  type RegionBody,
  type RelatedBody,
  type RelatedResult,
} from "@/lib/contract/schemas";

import { findingQuotes, sharesEvidence } from "./carry";
import { countFindings } from "./coverage";
import { findFile } from "./packages";
import { ocrText, recipientContext } from "./pipeline";
import { readEffectiveSettings } from "./settings";
import {
  readCoverage,
  readDocument,
  readFindings,
  readOcr,
  readOriginal,
  readPackage,
  updateRecipients,
  withFindingsLock,
  writeCoverage,
  writeFindings,
} from "./store";

// Review actions: decisions, manual regions, and related occurrences
// (R17-R19). Each change saves at once and returns the current package
// warnings, so the UI banner stays current without a reload (R23).

/** The new content of findings.json, and what the action returns. */
type FindingsChange<Result> = {
  findings: Finding[];
  result: Result;
};

/** Reads, changes, and saves findings.json; then updates the coverage counts. */
async function changeFindings<Result>(
  pkg: Package,
  change: (findings: Finding[]) => FindingsChange<Result> | Promise<FindingsChange<Result>>,
): Promise<FindingsChange<Result>> {
  return withFindingsLock(pkg.id, async () => {
    const changed = await change(await readFindings(pkg.id));

    await writeFindings(pkg.id, changed.findings);

    const coverage = await readCoverage(pkg.id);

    if (coverage !== null) {
      await writeCoverage(pkg.id, { ...coverage, ...countFindings(pkg.files, changed.findings) });
    }

    return changed;
  });
}

function warningsFor(layers: Layers, pkg: Package, findings: Finding[]) {
  return layers.detect.inconsistentRedactions({ findings, protectedTerms: pkg.protectedTerms, files: pkg.files });
}

/** `keep-and-remember` adds an allow rule to the package's recipient; never for a secret (M14). */
async function rememberKeeps(pkg: Package, findings: Finding[]): Promise<void> {
  const rules = findings.flatMap((finding) => {
    const matchText = findingQuotes(finding)[0] ?? null;

    if (finding.category === "secret" || matchText === null) {
      return [];
    }

    return [{ category: finding.category, matchText }];
  });

  if (rules.length === 0) {
    return;
  }

  await updateRecipients((recipients) =>
    recipients.map((recipient) => {
      if (recipient.id !== pkg.recipientId) {
        return recipient;
      }

      const allowRules = [...recipient.allowRules];

      for (const rule of rules) {
        const known = allowRules.some(
          (existing) => existing.category === rule.category && existing.matchText.toLowerCase() === rule.matchText.toLowerCase(),
        );

        if (!known) {
          const added: AllowRule = { id: `allow-${randomUUID()}`, ...rule, createdAt: new Date().toISOString() };

          allowRules.push(added);
        }
      }

      return { ...recipient, allowRules };
    }),
  );
}

export async function decideFinding(
  packageId: string,
  findingId: string,
  body: FindingDecisionBody,
  layers: Layers,
): Promise<FindingDecisionResult> {
  const pkg = await readPackage(packageId);

  const { findings, result } = await changeFindings(pkg, (current) => {
    const target = current.find((finding) => finding.id === findingId);

    if (target === undefined) {
      throw new ApiError("not-found", "No finding with this id.");
    }

    const group = body.applyToGroup ? target.relatedGroupId : null;
    const decided = (finding: Finding) => finding.id === target.id || (group !== null && finding.relatedGroupId === group);
    const next = current.map((finding) => (decided(finding) ? { ...finding, decision: body.decision } : finding));

    return { findings: next, result: next.filter(decided) };
  });

  if (body.decision === "keep-and-remember") {
    await rememberKeeps(pkg, result);
  }

  return { findings: result, warnings: warningsFor(layers, pkg, findings) };
}

function manualDetection(box: Detection["evidence"][number] & { type: "image-region" }): Detection {
  return { method: "manual", ruleId: null, evidence: [box] };
}

/** A manual finding with the fields `add` and `add-span` share. */
function manualFinding(
  body: { fileId: string; category: Finding["category"] },
  fields: Pick<Finding, "detections" | "title" | "reason" | "decision">,
): Finding {
  return {
    id: `fnd-${randomUUID()}`,
    fileId: body.fileId,
    category: body.category,
    suggestedAction: "redact",
    allowedByRecipient: false,
    relatedGroupId: null,
    ...fields,
  };
}

async function cachedModel(packageId: string, fileId: string): Promise<DocumentModel> {
  const model = await readDocument(packageId, fileId);

  if (model === null) {
    throw new ApiError("conflict", "Scan the package to see this document.");
  }

  return model;
}

/** The anchor to store on a manual box: `page:<n>` inside a PDF's pages for a document, none for an image. */
async function boxAnchor(pkg: Package, file: FileEntry, anchor: string | null | undefined): Promise<string | undefined> {
  if (file.kind !== "document") {
    return undefined;
  }

  const page = pageOfAnchor(anchor);

  if (page === null || page > (await cachedModel(pkg.id, file.id)).pages.length) {
    throw new ApiError("bad-request", "Draw the box on a page of the document.");
  }

  return anchor ?? undefined;
}

export async function saveRegion(packageId: string, body: RegionBody, layers: Layers): Promise<FindingDecisionResult> {
  const pkg = await readPackage(packageId);

  const { findings, result } = await changeFindings(pkg, async (current): Promise<FindingsChange<Finding[]>> => {
    if (body.action === "add") {
      const file = findFile(pkg, body.fileId);

      if (file.kind !== "image" && file.kind !== "document") {
        throw new ApiError("bad-request", "Manual regions are for images and documents only.");
      }

      const anchor = await boxAnchor(pkg, file, body.anchor);

      const created = manualFinding(body, {
        detections: [manualDetection({ type: "image-region", box: body.box, quote: null, anchor })],
        title: "Manual region",
        reason: "You drew this region.",
        decision: "redact",
      });

      return { findings: [...current, created], result: [created] };
    }

    if (body.action === "add-span") {
      if (findFile(pkg, body.fileId).kind !== "document") {
        throw new ApiError("bad-request", "Text selections are only for documents; draw a box on images.");
      }

      const { text } = await cachedModel(pkg.id, body.fileId);

      if (body.start >= body.end || body.end > text.length) {
        throw new ApiError("bad-request", "The selection is outside the document text.");
      }

      const quote = text.slice(body.start, body.end);
      const line = text.slice(0, body.start).split("\n").length - 1;

      const created = manualFinding(body, {
        detections: [{ method: "manual", ruleId: null, evidence: [{ type: "text-span", start: body.start, end: body.end, line, quote }] }],
        title: "Manual selection",
        reason: "You selected this text.",
        decision: "open",
      });

      return { findings: [...current, created], result: [created] };
    }

    const target = current.find((finding) => finding.id === body.findingId);

    if (target === undefined) {
      throw new ApiError("not-found", "No finding with this id.");
    }

    const layerDetections = target.detections.filter((detection) => detection.method !== "manual");

    if (body.action === "delete") {
      // A manual finding goes away; another finding only loses its manual box.
      if (layerDetections.length === 0) {
        return { findings: current.filter((finding) => finding.id !== target.id), result: [] };
      }

      const cleared = { ...target, detections: layerDetections };

      return { findings: current.map((finding) => (finding.id === target.id ? cleared : finding)), result: [cleared] };
    }

    const anchor = await boxAnchor(pkg, findFile(pkg, target.fileId), body.anchor);

    const moved: Finding = {
      ...target,
      detections: [...layerDetections, manualDetection({ type: "image-region", box: body.box, quote: null, anchor })],
    };

    return { findings: current.map((finding) => (finding.id === target.id ? moved : finding)), result: [moved] };
  });

  return { findings: result, warnings: warningsFor(layers, pkg, findings) };
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

/** Text of every readable file: the content of text files, the OCR text of images. */
async function relatedSources(pkg: Package): Promise<RelatedSource[]> {
  const sources = await Promise.all(
    pkg.files.map(async (file: FileEntry): Promise<RelatedSource[]> => {
      if (file.status !== "processed" && file.status !== "pending") {
        return [];
      }

      if (file.kind === "text") {
        return [{ fileId: file.id, fileName: file.originalName, text: utf8.decode(await readOriginal(pkg.id, file)), ocrWords: null }];
      }

      const ocr = file.kind === "image" ? await readOcr(pkg.id, file.id) : null;

      if (ocr === null) {
        return [];
      }

      return [{ fileId: file.id, fileName: file.originalName, text: ocrText(ocr.words), ocrWords: ocr.words }];
    }),
  );

  return sources.flat();
}

/** Exact matches (Stream 2) plus AI suggestions in Full and Text AI mode (Stream 3), in one related group (M13). */
export async function findRelated(packageId: string, body: RelatedBody, layers: Layers): Promise<RelatedResult> {
  const pkg = await readPackage(packageId);
  const sources = await relatedSources(pkg);
  const mode = pkg.lastScan?.mode ?? "rules-only";
  const exact = await layers.detect.findRelatedExact({ term: body.term, sources });
  let suggested: FindingCandidate[] = [];

  if (mode === "full" || mode === "text-ai") {
    try {
      suggested = await layers.ai.findRelatedSuggestions({ term: body.term, sources, settings: await readEffectiveSettings() });
    } catch {
      // The model is not reachable: exact matches still help.
      suggested = [];
    }
  }

  const context = await recipientContext(pkg.recipientId);

  const profiled = (candidates: FindingCandidate[]) =>
    layers.detect.applyProfile({ candidates, profile: context.profile, recipient: context.recipient });

  const { result } = await changeFindings(pkg, (current) => {
    const all = [...current];
    const matched = (candidate: FindingCandidate) => all.find((finding) => sharesEvidence(candidate, finding));

    // An existing group for this term is reused, so earlier decisions stay in one group.
    const existingGroup = [...exact, ...suggested]
      .map((candidate) => matched(candidate)?.relatedGroupId ?? null)
      .find((group) => group !== null);

    const relatedGroupId = existingGroup ?? `rel-${randomUUID()}`;

    const place = (candidates: FindingCandidate[]): Finding[] =>
      profiled(candidates).map((candidate) => {
        const existing = matched(candidate);

        if (existing !== undefined) {
          const joined = { ...existing, relatedGroupId };

          all.splice(all.indexOf(existing), 1, joined);

          return joined;
        }

        const created: Finding = { ...candidate, id: `fnd-${randomUUID()}`, decision: "open", relatedGroupId };

        all.push(created);

        return created;
      });

    const exactFindings = place(exact);
    const aiFindings = place(suggested);

    return { findings: all, result: { term: body.term, relatedGroupId, exact: exactFindings, aiSuggestions: aiFindings } };
  });

  return result;
}
