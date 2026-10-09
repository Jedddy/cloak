import { ApiErrorSchema, type ApiErrorBody } from "@/lib/contract/errors";
import type {
  ConnectionTestResult,
  ExportStartBody,
  FileEntry,
  FileUpdateBody,
  FindingDecisionBody,
  FindingDecisionResult,
  Job,
  JobStartResponse,
  OcrResult,
  OkResponse,
  Package,
  PackageCreateBody,
  PackageDetail,
  ProfileUpsertBody,
  Recipient,
  RecipientProfile,
  RecipientUpsertBody,
  RegionBody,
  RelatedBody,
  RelatedResult,
  ScanStartBody,
  SettingsResponse,
  SettingsUpdateBody,
} from "@/lib/contract/schemas";

export class ClientError extends Error {
  readonly code: string;
  readonly details: string[];

  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ClientError";
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    throw new ClientError(
      ApiErrorSchema.parse(await response.json().catch(() => null)),
    );
  }

  // SAFETY: callers request the contract type of the route they called.
  return (await response.json()) as T;
}

function encode(id: string): string {
  return encodeURIComponent(id);
}

// Every route in lib/contract/routes.ts has a function here.

export function getSettings(): Promise<SettingsResponse> {
  return requestJson<SettingsResponse>("/api/settings");
}

export function saveSettings(body: SettingsUpdateBody): Promise<SettingsResponse> {
  return requestJson<SettingsResponse>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function testSettings(): Promise<ConnectionTestResult> {
  return requestJson<ConnectionTestResult>("/api/settings/test", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function listProfiles(): Promise<RecipientProfile[]> {
  return requestJson<RecipientProfile[]>("/api/profiles");
}

export function saveProfile(body: ProfileUpsertBody): Promise<RecipientProfile> {
  return requestJson<RecipientProfile>("/api/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listRecipients(): Promise<Recipient[]> {
  return requestJson<Recipient[]>("/api/recipients");
}

export function saveRecipient(body: RecipientUpsertBody): Promise<Recipient> {
  return requestJson<Recipient>("/api/recipients", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPackages(): Promise<Package[]> {
  return requestJson<Package[]>("/api/packages");
}

export function createPackage(body: PackageCreateBody): Promise<Package> {
  return requestJson<Package>("/api/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getPackage(id: string): Promise<PackageDetail> {
  return requestJson<PackageDetail>(`/api/packages/${encode(id)}`);
}

export function deletePackage(id: string): Promise<OkResponse> {
  return requestJson<OkResponse>(`/api/packages/${encode(id)}`, {
    method: "DELETE",
  });
}

/** Upload sends one file per request, in sequence. */
export async function uploadFile(id: string, file: File): Promise<FileEntry> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`/api/packages/${encode(id)}/files`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new ClientError(
      ApiErrorSchema.parse(await response.json().catch(() => null)),
    );
  }

  // SAFETY: the upload route responds with a contract FileEntry.
  return (await response.json()) as FileEntry;
}

export function originalFileUrl(id: string, fileId: string): string {
  return `/api/packages/${encode(id)}/files/${encode(fileId)}`;
}

export function updateFile(
  id: string,
  fileId: string,
  body: FileUpdateBody,
): Promise<FileEntry> {
  return requestJson<FileEntry>(
    `/api/packages/${encode(id)}/files/${encode(fileId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function getFileOcr(id: string, fileId: string): Promise<OcrResult> {
  return requestJson<OcrResult>(
    `/api/packages/${encode(id)}/files/${encode(fileId)}/ocr`,
  );
}

export function startScan(
  id: string,
  body: ScanStartBody,
): Promise<JobStartResponse> {
  return requestJson<JobStartResponse>(`/api/packages/${encode(id)}/scan`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getJob(id: string, jobId: string): Promise<Job> {
  return requestJson<Job>(`/api/packages/${encode(id)}/jobs/${encode(jobId)}`);
}

export function decideFinding(
  id: string,
  findingId: string,
  body: FindingDecisionBody,
): Promise<FindingDecisionResult> {
  return requestJson<FindingDecisionResult>(
    `/api/packages/${encode(id)}/findings/${encode(findingId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function saveRegion(
  id: string,
  body: RegionBody,
): Promise<FindingDecisionResult> {
  return requestJson<FindingDecisionResult>(
    `/api/packages/${encode(id)}/regions`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function findRelated(
  id: string,
  body: RelatedBody,
): Promise<RelatedResult> {
  return requestJson<RelatedResult>(`/api/packages/${encode(id)}/related`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startExport(
  id: string,
  body: ExportStartBody,
): Promise<JobStartResponse> {
  return requestJson<JobStartResponse>(`/api/packages/${encode(id)}/export`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function exportZipUrl(id: string): string {
  return `/api/packages/${encode(id)}/export.zip`;
}

export function reviewedFileUrl(id: string, fileId: string): string {
  return `/api/packages/${encode(id)}/reviewed/${encode(fileId)}`;
}
