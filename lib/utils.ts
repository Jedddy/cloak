export { cn } from "cn";

import type { Locality, Mode } from "@/lib/contract/schemas";

/** "482.1 KB", "5.0 KB": file sizes in lists use one decimal unit. */
export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unit = units[0];
  for (const next of units.slice(1)) {
    if (value < 1024) {
      break;
    }
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/** Local date and time for package lists. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function modeLabel(mode: Mode): string {
  if (mode === "full") {
    return "Full";
  }
  if (mode === "text-ai") {
    return "Text AI";
  }
  return "Rules only";
}

export function localityLabel(locality: Locality): string {
  if (locality === "local") {
    return "Local";
  }
  if (locality === "lan") {
    return "LAN";
  }
  if (locality === "remote") {
    return "Remote";
  }
  return "Mock";
}

/** Hostname of a model URL, for the locality badge and dialogs. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
