import { beforeEach, expect, test } from "bun:test";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";

import JSZip from "jszip";

import { fixtureProfiles } from "@/lib/contract/fixtures";
import type { Layers } from "@/lib/contract/interfaces";
import { NO_OPEN_FINDINGS_TEXT, type Finding, type Package } from "@/lib/contract/schemas";
import { stubLayers } from "@/lib/contract/stubs";

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
  readFindings,
  readPackage,
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
