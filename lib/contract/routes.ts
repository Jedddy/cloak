import { z } from "zod";

import {
  ConnectionTestResultSchema,
  ExportStartBodySchema,
  FileEntrySchema,
  FileUpdateBodySchema,
  FindingDecisionBodySchema,
  FindingDecisionResultSchema,
  JobSchema,
  JobStartResponseSchema,
  OcrResultSchema,
  OkResponseSchema,
  PackageCreateBodySchema,
  PackageDetailSchema,
  PackageSchema,
  ProfileUpsertBodySchema,
  RecipientProfileSchema,
  RecipientSchema,
  RecipientUpsertBodySchema,
  RegionBodySchema,
  RelatedBodySchema,
  RelatedResultSchema,
  ScanStartBodySchema,
  SettingsResponseSchema,
  SettingsUpdateBodySchema,
} from "./schemas";

// The HTTP route table (R5). lib/client derives its request and response
// types from here. Errors use ApiErrorSchema from ./errors on every route.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRoute = {
  method: HttpMethod;
  /** Path with Next.js placeholders, for example `/api/packages/[id]`. */
  path: string;
  /** JSON body schema, "multipart" for upload (one file per request, field `file`), or null. */
  body: z.ZodType | "multipart" | null;
  /** JSON response schema, or "binary" for a file stream. */
  response: z.ZodType | "binary";
};

export const apiRoutes = {
  getSettings: {
    method: "GET",
    path: "/api/settings",
    body: null,
    response: SettingsResponseSchema,
  },
  saveSettings: {
    method: "PUT",
    path: "/api/settings",
    body: SettingsUpdateBodySchema,
    response: SettingsResponseSchema,
  },
  testSettings: {
    method: "POST",
    path: "/api/settings/test",
    body: null,
    response: ConnectionTestResultSchema,
  },
  listProfiles: {
    method: "GET",
    path: "/api/profiles",
    body: null,
    response: z.array(RecipientProfileSchema),
  },
  saveProfile: {
    method: "POST",
    path: "/api/profiles",
    body: ProfileUpsertBodySchema,
    response: RecipientProfileSchema,
  },
  listRecipients: {
    method: "GET",
    path: "/api/recipients",
    body: null,
    response: z.array(RecipientSchema),
  },
  saveRecipient: {
    method: "POST",
    path: "/api/recipients",
    body: RecipientUpsertBodySchema,
    response: RecipientSchema,
  },
  listPackages: {
    method: "GET",
    path: "/api/packages",
    body: null,
    response: z.array(PackageSchema),
  },
  createPackage: {
    method: "POST",
    path: "/api/packages",
    body: PackageCreateBodySchema,
    response: PackageSchema,
  },
  getPackage: {
    method: "GET",
    path: "/api/packages/[id]",
    body: null,
    response: PackageDetailSchema,
  },
  deletePackage: {
    method: "DELETE",
    path: "/api/packages/[id]",
    body: null,
    response: OkResponseSchema,
  },
  uploadFile: {
    method: "POST",
    path: "/api/packages/[id]/files",
    body: "multipart",
    response: FileEntrySchema,
  },
  getOriginalFile: {
    method: "GET",
    path: "/api/packages/[id]/files/[fileId]",
    body: null,
    response: "binary",
  },
  updateFile: {
    method: "PATCH",
    path: "/api/packages/[id]/files/[fileId]",
    body: FileUpdateBodySchema,
    response: FileEntrySchema,
  },
  getFileOcr: {
    method: "GET",
    path: "/api/packages/[id]/files/[fileId]/ocr",
    body: null,
    response: OcrResultSchema,
  },
  startScan: {
    method: "POST",
    path: "/api/packages/[id]/scan",
    body: ScanStartBodySchema,
    response: JobStartResponseSchema,
  },
  getJob: {
    method: "GET",
    path: "/api/packages/[id]/jobs/[jobId]",
    body: null,
    response: JobSchema,
  },
  decideFinding: {
    method: "PATCH",
    path: "/api/packages/[id]/findings/[findingId]",
    body: FindingDecisionBodySchema,
    response: FindingDecisionResultSchema,
  },
  saveRegion: {
    method: "POST",
    path: "/api/packages/[id]/regions",
    body: RegionBodySchema,
    response: FindingDecisionResultSchema,
  },
  findRelated: {
    method: "POST",
    path: "/api/packages/[id]/related",
    body: RelatedBodySchema,
    response: RelatedResultSchema,
  },
  startExport: {
    method: "POST",
    path: "/api/packages/[id]/export",
    body: ExportStartBodySchema,
    response: JobStartResponseSchema,
  },
  downloadExport: {
    method: "GET",
    path: "/api/packages/[id]/export.zip",
    body: null,
    response: "binary",
  },
  getReviewedFile: {
    method: "GET",
    path: "/api/packages/[id]/reviewed/[fileId]",
    body: null,
    response: "binary",
  },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteName = keyof typeof apiRoutes;
