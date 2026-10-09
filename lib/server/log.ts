/** Field values for server logs: ids, counts, modes, and statuses only, never file content or quotes (R10). */
export type LogFields = Record<string, string | number | boolean | null>;

export function logEvent(event: string, fields: LogFields): void {
  console.info(`[sentinel] ${event}`, JSON.stringify(fields));
}
