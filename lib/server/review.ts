import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/contract/errors";
import type { Layers, RelatedSource } from "@/lib/contract/interfaces";
import type {
  AllowRule,
  Detection,
  FileEntry,
  Finding,
  FindingCandidate,
  FindingDecisionBody,
  FindingDecisionResult,
  Package,
  RegionBody,
  RelatedBody,
  RelatedResult,
} from "@/lib/contract/schemas";

import { findingQuotes, sharesEvidence } from "./carry";
import { countFindings } from "./coverage";
import { findFile } from "./packages";
import { ocrText, recipientContext } from "./pipeline";
import { readEffectiveSettings } from "./settings";
import {
  readCoverage,
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

export async function saveRegion(packageId: string, body: RegionBody, layers: Layers): Promise<FindingDecisionResult> {
  const pkg = await readPackage(packageId);

  const { findings, result } = await changeFindings(pkg, (current): FindingsChange<Finding[]> => {
    if (body.action === "add") {
      if (findFile(pkg, body.fileId).kind !== "image") {
        throw new ApiError("bad-request", "Manual regions are for images only.");
      }

      const created: Finding = {
        id: `fnd-${randomUUID()}`,
        fileId: body.fileId,
        category: body.category,
        detections: [manualDetection({ type: "image-region", box: body.box, quote: null })],
        title: "Manual region",
        reason: "You drew this region.",
        suggestedAction: "redact",
        allowedByRecipient: false,
        decision: "redact",
        relatedGroupId: null,
      };

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

    const moved: Finding = {
      ...target,
      detections: [...layerDetections, manualDetection({ type: "image-region", box: body.box, quote: null })],
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
