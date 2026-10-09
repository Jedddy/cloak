import type { TextRedactionInput, TextRedactionSpan } from "@/lib/contract/interfaces";

// Text redaction (overview section 14, plan R21). Replaces each approved
// span with [REDACTED]. In .env files the key is kept and only the value
// is replaced. Line endings and encoding pass through untouched because
// spans are applied as offsets into the original string.

const PLACEHOLDER = "[REDACTED]";

function isEnvFile(fileName: string): boolean {
  const base = fileName.split("/").pop() ?? fileName;

  return base === ".env" || base.startsWith(".env.");
}

function envValueRange(content: string, spanStart: number): { start: number; end: number } | null {
  const lineStart = content.lastIndexOf("\n", spanStart - 1) + 1;
  const lineEndRaw = content.indexOf("\n", spanStart);
  const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
  const line = content.slice(lineStart, lineEnd);
  const equals = line.indexOf("=");

  if (equals === -1) {
    return null;
  }

  const key = line.slice(0, equals).trim();

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) === false) {
    return null;
  }

  const valueStart = lineStart + equals + 1;

  // A span that does not reach the value leaves the line alone.
  if (spanStart >= lineEnd) {
    return null;
  }

  return { start: valueStart, end: lineEnd };
}

export function redactText(input: TextRedactionInput): string {
  const ordered = [...input.spans].sort((left, right) => left.start - right.start || right.end - left.end);

  const expanded: TextRedactionSpan[] = ordered.map((span) => {
    if (isEnvFile(input.fileName)) {
      const value = envValueRange(input.content, span.start);

      if (value !== null) {
        return { ...span, start: Math.min(value.start, value.end), end: Math.max(value.start, value.end) };
      }
    }

    return span;
  });

  let result = "";
  let cursor = 0;

  for (const span of expanded) {
    const start = Math.max(0, Math.min(span.start, input.content.length));
    const end = Math.max(0, Math.min(span.end, input.content.length));

    if (end <= start) {
      continue;
    }

    if (start < cursor) {
      // Overlapping the previous span: cover the union so no approved
      // slice stays visible.
      cursor = Math.max(cursor, end);
      continue;
    }

    result += input.content.slice(cursor, start) + PLACEHOLDER;
    cursor = end;
  }

  return result + input.content.slice(cursor);
}
