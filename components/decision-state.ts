import type { Decision } from "@/lib/contract/schemas";

/** A decision that is neither open nor an approved redaction: kept, rejected and the like. */
export function isSettled(decision: Decision): boolean {
  return decision !== "open" && decision !== "redact";
}
