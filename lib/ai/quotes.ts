import type { Evidence, OcrWord } from "@/lib/contract/schemas";

// Offset maps preserve the original source even when whitespace or Unicode
// lowercase conversion changes the length of a normalized string.
function normalize(text: string) {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];

  for (const match of text.matchAll(/\s+|[^\s]/gu)) {
    const part = /^\s/.test(match[0]) ? " " : match[0].toLowerCase();
    value += part;

    for (let i = 0; i < part.length; i++) {
      starts.push(match.index);
      ends.push(match.index + match[0].length);
    }
  }

  return { value, starts, ends };
}

function spans(quote: string, text: string): { start: number; end: number }[] {
  if (quote.trim() === "") return [];
  const exact: { start: number; end: number }[] = [];
  let start = text.indexOf(quote);

  while (start >= 0) {
    exact.push({ start, end: start + quote.length });
    start = text.indexOf(quote, start + quote.length);
  }

  if (exact.length > 0) return exact;

  const source = normalize(text);
  const target = normalize(quote).value.trim();
  start = source.value.indexOf(target);

  while (start >= 0) {
    exact.push({ start: source.starts[start], end: source.ends[start + target.length - 1] });
    start = source.value.indexOf(target, start + target.length);
  }

  return exact;
}

export function matchQuote(quote: string, text: string, ocrWords: OcrWord[] | null): Evidence[] {
  if (ocrWords === null) {
    const newlines = [...text.matchAll(/\r\n|\r|\n/g)].map((match) => match.index);
    let line = 0;

    return spans(quote, text).map(({ start, end }) => {
      while (line < newlines.length && newlines[line] < start) line++;

      return {
        type: "text-span",
        start,
        end,
        line,
        quote: text.slice(start, end),
      };
    });
  }

  const words = [...ocrWords].sort(
    (left, right) => left.line - right.line || left.box.x - right.box.x,
  );

  let source = "";

  const positioned = words.map((word) => {
    const start = source.length;
    source += `${word.text} `;

    return { word, start, end: start + word.text.length };
  });

  const evidence: Evidence[] = [];

  for (const span of spans(quote, source)) {
    const matched = positioned.filter((entry) => entry.start < span.end && entry.end > span.start);

    // OCR fallback must match whole words, never an invented substring of one.
    if (matched[0]?.start !== span.start || matched.at(-1)?.end !== span.end) continue;
    const lines = new Map<number, OcrWord[]>();

    for (const { word } of matched) {
      const line = lines.get(word.line) ?? [];
      line.push(word);
      lines.set(word.line, line);
    }

    for (const line of lines.values()) {
      const x = Math.min(...line.map((word) => word.box.x));
      const y = Math.min(...line.map((word) => word.box.y));
      const right = Math.max(...line.map((word) => word.box.x + word.box.w));
      const bottom = Math.max(...line.map((word) => word.box.y + word.box.h));
      evidence.push({
        type: "image-region",
        box: { x, y, w: right - x, h: bottom - y },
        quote: line.map((word) => word.text).join(" "),
      });
    }
  }

  return evidence;
}
