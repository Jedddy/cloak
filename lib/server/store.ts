import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import JSZip from "jszip";
import { z } from "zod";

import { ApiError } from "@/lib/contract/errors";
import { fixtureProfiles } from "@/lib/contract/fixtures";
import {
  CoverageReportSchema,
  DOCUMENT_MIMES,
  DocumentModelSchema,
  FindingSchema,
  OcrResultSchema,
  PackageSchema,
  RecipientProfileSchema,
  RecipientSchema,
  SavedSettingsSchema,
  UPLOAD_LIMITS,
  VerificationResultSchema,
  type CoverageReport,
  type DocumentFormat,
  type DocumentModel,
  type FileEntry,
  type FileKind,
  type Finding,
  type OcrResult,
  type Package,
  type PackageCreateBody,
  type ProfileUpsertBody,
  type Recipient,
  type RecipientProfile,
  type RecipientUpsertBody,
  type SavedSettings,
  type VerificationResult,
} from "@/lib/contract/schemas";

import { storedExtension, workspacePaths } from "./paths";

// All reads and writes of workspace/ go through this module (U6).

// ---------------------------------------------------------------------------
// JSON files
// ---------------------------------------------------------------------------

function isMissing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

/** Windows refuses a rename while another handle has the target open. */
function isBusy(error: Error): boolean {
  return "code" in error && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY");
}

async function readJsonFile<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.output<Schema> | null> {
  let text = "";

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return null;
    }

    throw error;
  }

  return schema.parse(JSON.parse(text));
}

/** Write to a temp file in the same folder, then rename (KTD9). */
async function writeJsonAtomic<Value>(path: string, value: Value): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, path);

      return;
    } catch (error) {
      if (!(error instanceof Error) || !isBusy(error) || attempt >= 20) {
        await rm(temp, { force: true });

        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Read-modify-write of one file runs one at a time per key, so two
// requests for the same package cannot drop each other's changes.
const queues = new Map<string, Promise<void>>();

async function serialized<Result>(key: string, run: () => Promise<Result>): Promise<Result> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run);

  const settled = next.then(
    () => undefined,
    () => undefined,
  );

  queues.set(key, settled);

  try {
    return await next;
  } finally {
    if (queues.get(key) === settled) {
      queues.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Settings, profiles, recipients
// ---------------------------------------------------------------------------

export async function readSavedSettings(): Promise<SavedSettings> {
  return (await readJsonFile(workspacePaths.config(), SavedSettingsSchema)) ?? {};
}

export async function writeSavedSettings(settings: SavedSettings): Promise<void> {
  await writeJsonAtomic(workspacePaths.config(), SavedSettingsSchema.parse(settings));
}

/** Seeds the presets on first read. Stream 2 presets replace the fixtures when they merge. */
export async function readProfiles(): Promise<RecipientProfile[]> {
  const saved = await readJsonFile(workspacePaths.profiles(), RecipientProfileSchema.array());

  if (saved !== null) {
    return saved;
  }

  await writeProfiles(fixtureProfiles);

  return fixtureProfiles;
}

export async function writeProfiles(profiles: RecipientProfile[]): Promise<void> {
  await writeJsonAtomic(workspacePaths.profiles(), RecipientProfileSchema.array().parse(profiles));
}

export async function readRecipients(): Promise<Recipient[]> {
  return (await readJsonFile(workspacePaths.recipients(), RecipientSchema.array())) ?? [];
}

export async function writeRecipients(recipients: Recipient[]): Promise<void> {
  await writeJsonAtomic(workspacePaths.recipients(), RecipientSchema.array().parse(recipients));
}

/** Applies `change` to recipients.json; changes run one at a time. */
export function updateRecipients(
  change: (recipients: Recipient[]) => Recipient[] | Promise<Recipient[]>,
): Promise<Recipient[]> {
  return serialized("workspace:recipients", async () => {
    const next = await change(await readRecipients());

    await writeRecipients(next);

    return next;
  });
}

/** Creates a profile, or updates the profile with `body.id`. */
export function saveProfile(body: ProfileUpsertBody): Promise<RecipientProfile> {
  return serialized("workspace:profiles", async () => {
    const profiles = await readProfiles();
    const profile: RecipientProfile = { ...body, id: body.id ?? `profile-${randomUUID()}` };

    if (body.id !== undefined && !profiles.some((entry) => entry.id === body.id)) {
      throw new ApiError("not-found", "No profile with this id.");
    }

    const others = profiles.filter((entry) => entry.id !== profile.id);

    await writeProfiles([...others, profile]);

    return profile;
  });
}

/** Creates a recipient, or updates the name and profile of `body.id`. Allow rules stay. */
export async function saveRecipient(body: RecipientUpsertBody): Promise<Recipient> {
  const profiles = await readProfiles();

  if (!profiles.some((profile) => profile.id === body.profileId)) {
    throw new ApiError("bad-request", "No profile with this id.");
  }

  let saved: Recipient = { id: body.id ?? `recipient-${randomUUID()}`, name: body.name, profileId: body.profileId, allowRules: [] };

  await updateRecipients((recipients) => {
    const existing = recipients.find((recipient) => recipient.id === saved.id);

    if (body.id !== undefined && existing === undefined) {
      throw new ApiError("not-found", "No recipient with this id.");
    }

    saved = { ...saved, allowRules: existing?.allowRules ?? [] };

    if (existing === undefined) {
      return [...recipients, saved];
    }

    return recipients.map((recipient) => (recipient.id === saved.id ? saved : recipient));
  });

  return saved;
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export async function listPackages(): Promise<Package[]> {
  let ids: string[] = [];

  try {
    ids = await readdir(workspacePaths.packages());
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return [];
    }

    throw error;
  }

  const packages = await Promise.all(
    ids.map((id) => readJsonFile(workspacePaths.packageJson(id), PackageSchema)),
  );

  return packages
    .flatMap((pkg) => (pkg === null ? [] : [pkg]))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function readPackage(packageId: string): Promise<Package> {
  const pkg = await readJsonFile(workspacePaths.packageJson(packageId), PackageSchema);

  if (pkg === null) {
    throw new ApiError("not-found", "No package with this id.");
  }

  return pkg;
}

/** Applies `change` to the stored package; changes to one package run one at a time. */
export function updatePackage(
  packageId: string,
  change: (pkg: Package) => Package | Promise<Package>,
): Promise<Package> {
  return serialized(`package:${packageId}`, async () => {
    const next = PackageSchema.parse(await change(await readPackage(packageId)));

    await writeJsonAtomic(workspacePaths.packageJson(packageId), next);

    return next;
  });
}

export async function createPackage(body: PackageCreateBody): Promise<Package> {
  const recipients = await readRecipients();

  if (!recipients.some((recipient) => recipient.id === body.recipientId)) {
    throw new ApiError("bad-request", "No recipient with this id.");
  }

  const pkg: Package = {
    id: `pkg-${randomUUID()}`,
    name: body.name,
    recipientId: body.recipientId,
    protectedTerms: body.protectedTerms,
    files: [],
    status: "draft",
    createdAt: new Date().toISOString(),
    lastScan: null,
    remoteConfirmed: false,
    interrupted: false,
  };

  await writeJsonAtomic(workspacePaths.packageJson(pkg.id), pkg);

  return pkg;
}

export async function deletePackage(packageId: string): Promise<void> {
  await readPackage(packageId);
  await serialized(`package:${packageId}`, () =>
    rm(workspacePaths.package(packageId), { recursive: true, force: true }),
  );
}

// ---------------------------------------------------------------------------
// Originals
// ---------------------------------------------------------------------------

export type Upload = {
  name: string;
  bytes: Uint8Array;
};

type KindResult = {
  kind: FileKind;
  mime: string;
  reason: string | null;
};

const textMimes: ReadonlyMap<string, string> = new Map([
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["json", "application/json"],
  ["csv", "text/csv"],
  ["env", "text/plain"],
  ["log", "text/plain"],
  ["yaml", "application/yaml"],
  ["yml", "application/yaml"],
]);

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const jpegMagic = [0xff, 0xd8, 0xff];

const pdfMagic = [0x25, 0x50, 0x44, 0x46, 0x2d];

const zipMagic = [0x50, 0x4b, 0x03, 0x04];

const cfbMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const macroReason = "Macro-enabled documents are not supported.";

const macroExtensions: ReadonlySet<string> = new Set(["docm", "xlsm", "pptm"]);

/** Per OOXML format: the part that proves it, the mismatch wording, and the encrypted-file reason. */
type OoxmlFormat = { format: DocumentFormat; mainPart: string; label: string; encrypted: string };

const ooxmlFormats: ReadonlyMap<string, OoxmlFormat> = new Map([
  ["docx", { format: "docx", mainPart: "word/document.xml", label: "DOCX, but the content is not a Word document", encrypted: "Encrypted document" }],
  ["xlsx", { format: "xlsx", mainPart: "xl/workbook.xml", label: "XLSX, but the content is not an Excel workbook", encrypted: "Encrypted workbook" }],
  ["pptx", { format: "pptx", mainPart: "ppt/presentation.xml", label: "PPTX, but the content is not a PowerPoint presentation", encrypted: "Encrypted presentation" }],
]);

/** Supported kinds follow M4: extension, plus a content check for images and documents. */
async function detectKind(extension: string, bytes: Uint8Array): Promise<KindResult> {
  const textMime = textMimes.get(extension);
  const unsupported = "application/octet-stream";

  if (textMime !== undefined) {
    return { kind: "text", mime: textMime, reason: null };
  }

  if (extension === "png") {
    if (startsWith(bytes, pngMagic)) {
      return { kind: "image", mime: "image/png", reason: null };
    }

    return { kind: "unsupported", mime: unsupported, reason: "The file name says PNG, but the content is not PNG." };
  }

  if (extension === "jpg" || extension === "jpeg") {
    if (startsWith(bytes, jpegMagic)) {
      return { kind: "image", mime: "image/jpeg", reason: null };
    }

    return { kind: "unsupported", mime: unsupported, reason: "The file name says JPEG, but the content is not JPEG." };
  }

  if (extension === "pdf") {
    if (!startsWith(bytes, pdfMagic)) {
      return { kind: "unsupported", mime: unsupported, reason: "The file name says PDF, but the content is not PDF." };
    }

    if (Buffer.from(bytes).toString("latin1").includes("/Encrypt")) {
      return { kind: "unsupported", mime: unsupported, reason: "Encrypted PDF" };
    }

    return { kind: "document", mime: DOCUMENT_MIMES.pdf, reason: null };
  }

  if (macroExtensions.has(extension)) {
    return { kind: "unsupported", mime: unsupported, reason: macroReason };
  }

  const ooxml = ooxmlFormats.get(extension);

  if (ooxml !== undefined) {
    const mismatch = { kind: "unsupported", mime: unsupported, reason: `The file name says ${ooxml.label}.` } as const;

    if (startsWith(bytes, cfbMagic)) {
      if (Buffer.from(bytes).includes(Buffer.from("EncryptionInfo", "utf16le"))) {
        return { kind: "unsupported", mime: unsupported, reason: ooxml.encrypted };
      }

      return mismatch;
    }

    if (!startsWith(bytes, zipMagic)) {
      return mismatch;
    }

    let zip: JSZip;

    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return mismatch;
    }

    if (zip.file(ooxml.mainPart) === null) {
      return mismatch;
    }

    if (Object.keys(zip.files).some((name) => name.endsWith("vbaProject.bin"))) {
      return { kind: "unsupported", mime: unsupported, reason: macroReason };
    }

    return { kind: "document", mime: DOCUMENT_MIMES[ooxml.format], reason: null };
  }

  return { kind: "unsupported", mime: unsupported, reason: "This file type is not supported." };
}

/** Stores an upload once, read-only, under a generated id, and adds it to the package. */
export async function addOriginal(packageId: string, upload: Upload): Promise<FileEntry> {
  if (upload.bytes.byteLength > UPLOAD_LIMITS.maxFileBytes) {
    throw new ApiError("too-large", "The file is larger than 25 MB.");
  }

  const extension = storedExtension(upload.name);
  const kind = await detectKind(extension, upload.bytes);

  const entry: FileEntry = {
    id: `file-${randomUUID()}`,
    originalName: upload.name,
    kind: kind.kind,
    mime: kind.mime,
    sizeBytes: upload.bytes.byteLength,
    sha256: sha256(upload.bytes),
    status: kind.kind === "unsupported" ? "unsupported" : "pending",
    failureReason: kind.reason,
    aiAnalysis: "skipped-no-model",
    excluded: false,
  };

  await updatePackage(packageId, async (pkg) => {
    if (pkg.files.length >= UPLOAD_LIMITS.maxFilesPerPackage) {
      throw new ApiError("limit-reached", "A package can have 50 files.");
    }

    const path = workspacePaths.original(packageId, entry.id, extension);

    await mkdir(dirname(path), { recursive: true });
    // "wx" fails if the file exists: an original is never written twice.
    await writeFile(path, upload.bytes, { flag: "wx", mode: 0o444 });

    return { ...pkg, files: [...pkg.files, entry] };
  });

  return entry;
}

export function originalPath(packageId: string, file: FileEntry): string {
  return workspacePaths.original(packageId, file.id, storedExtension(file.originalName));
}

export async function readOriginal(packageId: string, file: FileEntry): Promise<Uint8Array> {
  return new Uint8Array(await readFile(originalPath(packageId, file)));
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Scan results
// ---------------------------------------------------------------------------

export async function readFindings(packageId: string): Promise<Finding[]> {
  return (await readJsonFile(workspacePaths.findings(packageId), FindingSchema.array())) ?? [];
}

export async function writeFindings(packageId: string, findings: Finding[]): Promise<void> {
  await writeJsonAtomic(workspacePaths.findings(packageId), FindingSchema.array().parse(findings));
}

/** Runs a read-modify-write of findings.json one at a time per package. */
export function withFindingsLock<Result>(packageId: string, run: () => Promise<Result>) {
  return serialized(`findings:${packageId}`, run);
}

export async function readCoverage(packageId: string): Promise<CoverageReport | null> {
  return readJsonFile(workspacePaths.coverage(packageId), CoverageReportSchema);
}

export async function writeCoverage(packageId: string, coverage: CoverageReport): Promise<void> {
  await writeJsonAtomic(workspacePaths.coverage(packageId), CoverageReportSchema.parse(coverage));
}

export async function readVerification(packageId: string): Promise<VerificationResult | null> {
  return readJsonFile(workspacePaths.verification(packageId), VerificationResultSchema);
}

export async function writeVerification(packageId: string, result: VerificationResult): Promise<void> {
  await writeJsonAtomic(workspacePaths.verification(packageId), VerificationResultSchema.parse(result));
}

export async function readOcr(packageId: string, fileId: string): Promise<OcrResult | null> {
  return readJsonFile(workspacePaths.ocr(packageId, fileId), OcrResultSchema);
}

export async function writeOcr(packageId: string, fileId: string, ocr: OcrResult): Promise<void> {
  await writeJsonAtomic(workspacePaths.ocr(packageId, fileId), OcrResultSchema.parse(ocr));
}

export async function readDocument(packageId: string, fileId: string): Promise<DocumentModel | null> {
  return readJsonFile(workspacePaths.document(packageId, fileId), DocumentModelSchema);
}

export async function writeDocument(packageId: string, fileId: string, model: DocumentModel): Promise<void> {
  await writeJsonAtomic(workspacePaths.document(packageId, fileId), DocumentModelSchema.parse(model));
}

export async function deleteVerification(packageId: string): Promise<void> {
  await rm(workspacePaths.verification(packageId), { force: true });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Which reviewed/ name holds the copy of which file. Kept outside reviewed/, so it is not in the zip. */
const ExportManifestSchema = z.array(z.object({ fileId: z.string(), name: z.string() }));

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

export async function readExportManifest(packageId: string): Promise<ExportManifest> {
  return (await readJsonFile(workspacePaths.exportManifest(packageId), ExportManifestSchema)) ?? [];
}

export async function writeExportManifest(packageId: string, manifest: ExportManifest): Promise<void> {
  await writeJsonAtomic(workspacePaths.exportManifest(packageId), ExportManifestSchema.parse(manifest));
}
