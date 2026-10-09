import { ApiError } from "@/lib/contract/errors";
import type { FileEntry, Package, PackageDetail, PackageStatus } from "@/lib/contract/schemas";

import { hasLiveJob } from "./jobs";
import { layers } from "./layers";
import { readCoverage, readFindings, readPackage, readVerification, updatePackage } from "./store";

/** The status a package goes back to when its job stopped or failed (KTD5). */
export function statusBeforeJob(pkg: Package): PackageStatus {
  if (pkg.status === "scanning" && pkg.lastScan === null) {
    return "draft";
  }

  return "scanned";
}

/** Reads a package; a scan or export with no live job is reported as interrupted. */
export async function readCurrentPackage(packageId: string): Promise<Package> {
  const pkg = await readPackage(packageId);
  const running = pkg.status === "scanning" || pkg.status === "exporting";

  if (!running || hasLiveJob(packageId)) {
    return pkg;
  }

  return updatePackage(packageId, (current) => {
    if (current.status !== "scanning" && current.status !== "exporting") {
      return current;
    }

    return { ...current, status: statusBeforeJob(current), interrupted: true };
  });
}

export async function getPackageDetail(packageId: string): Promise<PackageDetail> {
  const pkg = await readCurrentPackage(packageId);

  const [findings, coverage, verification] = await Promise.all([
    readFindings(packageId),
    readCoverage(packageId),
    readVerification(packageId),
  ]);

  const warnings = layers.detect.inconsistentRedactions({
    findings,
    protectedTerms: pkg.protectedTerms,
    files: pkg.files,
  });

  return { package: pkg, findings, coverage, warnings, verification, interrupted: pkg.interrupted };
}

export function findFile(pkg: Package, fileId: string): FileEntry {
  const file = pkg.files.find((entry) => entry.id === fileId);

  if (file === undefined) {
    throw new ApiError("not-found", "No file with this id in the package.");
  }

  return file;
}
