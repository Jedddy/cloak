import { join, resolve } from "node:path";

import { ApiError } from "@/lib/contract/errors";

// Every path into workspace/ is built here from generated ids. Upload names
// never become paths (R8, overview section 17 item 6).

const safeId = /^[A-Za-z0-9_-]{1,80}$/;

/** The workspace root. `SENTINEL_WORKSPACE_DIR` lets tests use a temp folder. */
export function workspaceRoot(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.SENTINEL_WORKSPACE_DIR || join(process.cwd(), "workspace"));
}

/** Ids come from URLs; anything that is not a generated id cannot exist. */
export function assertSafeId(id: string, label: string): string {
  if (!safeId.test(id)) {
    throw new ApiError("not-found", `No ${label} with this id.`);
  }

  return id;
}

export const workspacePaths = {
  config: () => join(workspaceRoot(), "config.json"),
  profiles: () => join(workspaceRoot(), "profiles.json"),
  recipients: () => join(workspaceRoot(), "recipients.json"),
  packages: () => join(workspaceRoot(), "packages"),
  package: (packageId: string) =>
    join(workspaceRoot(), "packages", assertSafeId(packageId, "package")),
  packageJson: (packageId: string) => join(workspacePaths.package(packageId), "package.json"),
  findings: (packageId: string) => join(workspacePaths.package(packageId), "findings.json"),
  coverage: (packageId: string) => join(workspacePaths.package(packageId), "coverage.json"),
  verification: (packageId: string) =>
    join(workspacePaths.package(packageId), "verification.json"),
  originalDir: (packageId: string) => join(workspacePaths.package(packageId), "original"),
  original: (packageId: string, fileId: string, extension: string) =>
    join(
      workspacePaths.originalDir(packageId),
      `${assertSafeId(fileId, "file")}${extension === "" ? "" : `.${extension}`}`,
    ),
  ocr: (packageId: string, fileId: string) =>
    join(workspacePaths.package(packageId), "derived", `${assertSafeId(fileId, "file")}.ocr.json`),
  document: (packageId: string, fileId: string) =>
    join(workspacePaths.package(packageId), "derived", `${assertSafeId(fileId, "file")}.document.json`),
  exportManifest: (packageId: string) => join(workspacePaths.package(packageId), "export-manifest.json"),
  reviewedDir: (packageId: string) => join(workspacePaths.package(packageId), "reviewed"),
  /** `exportName` must come from sanitizeExportName. */
  reviewed: (packageId: string, exportName: string) =>
    join(workspacePaths.reviewedDir(packageId), exportName),
};

/** Lower-case extension of an upload name, reduced to [a-z0-9]. `.env*` files map to `env`. */
export function storedExtension(originalName: string): string {
  const base = baseName(originalName).toLowerCase();

  if (base.startsWith(".env")) {
    return "env";
  }

  const dot = base.lastIndexOf(".");

  if (dot <= 0) {
    return "";
  }

  return base.slice(dot + 1).replace(/[^a-z0-9]/g, "").slice(0, 10);
}

function baseName(name: string): string {
  const parts = name.split(/[\\/]/);

  return parts[parts.length - 1] ?? "";
}

const windowsReservedNames = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A file name that is safe to write in reviewed/ and in the zip: no folders, no reserved names. */
export function sanitizeExportName(originalName: string): string {
  let name = baseName(originalName)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 120);

  if (name === "" || /^\.+$/.test(name)) {
    name = "file";
  }

  if (windowsReservedNames.test(name)) {
    name = `_${name}`;
  }

  return name;
}
