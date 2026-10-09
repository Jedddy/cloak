import type { DocumentResidueInput } from "@/lib/contract/interfaces";
import { RESIDUE_MIN_NEEDLE } from "@/lib/contract/schemas";
import { containsWord, decodeXmlEntities, normalizeText } from "@/lib/utils";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Independent residue check (KTD6): searches a reviewed copy for text that
// should be gone, using pdfjs (not MuPDF) and a raw look at the strings of every stream.

/**
 * CMaps and standard fonts shipped with the installed pdfjs-dist, read from disk (no network). Resolved from the
 * working directory because the bundler rewrites require.resolve to a module id; node_modules sits there in every
 * deployment (see Dockerfile).
 */
const pdfjsRoot = join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "pdfjs-dist");

const pdfjsAssets = { cMapUrl: `${pdfjsRoot}/cmaps/`, standardFontDataUrl: `${pdfjsRoot}/standard_fonts/` };

async function pdfjsTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0, cMapPacked: true, ...pdfjsAssets });

  try {
    const doc = await task.promise;
    const texts: string[] = [];

    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const items = (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : []));

      texts.push(normalizeText(items.join(" ")), normalizeText(items.join("")));
    }

    return texts;
  } finally {
    await task.destroy();
  }
}

const PDF_ESCAPES = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["b", "\b"],
  ["f", "\f"],
]);

/** Longest literal string looked for, so that a stray "(" in binary data cannot make the scan quadratic. */
const MAX_LITERAL_STRING = 65536;

/** The literal `( ... )` strings of PDF syntax: balanced parentheses, `\(` `\)` `\\` escapes, `\ddd` octal codes, line continuations. */
function literalStrings(source: string): string[] {
  const strings: string[] = [];

  for (let at = source.indexOf("("); at !== -1; at = source.indexOf("(", at + 1)) {
    let depth = 1;
    let text = "";
    let index = at + 1;

    for (; index < source.length && depth > 0 && index - at <= MAX_LITERAL_STRING; index += 1) {
      const char = source[index]!;

      if (char === "\\") {
        const octal = /^[0-7]{1,3}/.exec(source.slice(index + 1, index + 4));
        const next = source[index + 1] ?? "";

        if (octal) {
          text += String.fromCharCode(Number.parseInt(octal[0], 8) & 255);
          index += octal[0].length;
        } else if (next === "\n" || next === "\r") {
          index += next === "\r" && source[index + 2] === "\n" ? 2 : 1;
        } else {
          text += PDF_ESCAPES.get(next) ?? next;
          index += 1;
        }
      } else if (char === "(") {
        depth += 1;
        text += char;
      } else if (char === ")") {
        depth -= 1;
        text += depth > 0 ? char : "";
      } else {
        text += char;
      }
    }

    if (depth === 0) {
      strings.push(text);
      at = index - 1;
    }
  }

  return strings;
}

/** The decoded `<hex>` strings of PDF syntax (an odd last digit counts as followed by 0). */
function hexStrings(source: string): string[] {
  return [...source.matchAll(/<([0-9a-fA-F\s]{2,})>/g)].map((match) => {
    const digits = match[1]!.replace(/\s/g, "");

    return Buffer.from(digits.length % 2 === 0 ? digits : `${digits}0`, "hex").toString("latin1");
  });
}

/** What a PDF string (as Latin-1 bytes) says in each text encoding it may use: PDFDocEncoding/Latin-1, UTF-16BE and UTF-8. */
function stringTexts(bytes: string): string[] {
  const texts = [bytes];
  const buffer = Buffer.from(bytes, "latin1");

  if (bytes.startsWith("\u00fe\u00ff") || bytes.includes("\0")) {
    texts.push(Buffer.from(buffer.subarray(0, buffer.length - (buffer.length % 2))).swap16().toString("utf16le"));
  }

  if (bytes.startsWith("\u00ef\u00bb\u00bf")) {
    texts.push(buffer.toString("utf8"));
  }

  return texts;
}

/** Text and attribute values of an XML document (XMP metadata), never tag names. */
function xmlTexts(xml: string): string[] {
  const values = [...xml.matchAll(/="([^"]*)"|='([^']*)'/g)].map((match) => match[1] ?? match[2]);

  return [normalizeText(decodeXmlEntities(xml.replace(/<[^>]*>/g, ""))), normalizeText(decodeXmlEntities(values.join("\n")))];
}

/**
 * Views of the raw file and of every stream (inflated when it inflates): the string operands only, so a needle
 * cannot hit names such as `/Type /Page` or operators. Strings are joined with a space and with nothing, because
 * a content stream may split a word across the strings of a TJ array. XMP metadata is read as XML text.
 */
function rawViews(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const sources = [raw];

  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = Buffer.from(match[1]!, "latin1");

    try {
      sources.push(inflateSync(body).toString("latin1"));
    } catch {
      sources.push(match[1]!);
    }
  }

  return sources.flatMap((source) => {
    const strings = [...literalStrings(source), ...hexStrings(source)].flatMap(stringTexts).map(normalizeText);
    const views = [strings.join(" "), strings.join("")];

    if (source.includes("<x:xmpmeta") || source.includes("<?xpacket")) {
      views.push(...xmlTexts(Buffer.from(source, "latin1").toString("utf8")));
    }

    return views;
  });
}

async function ooxmlViews(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const views: string[] = [];

  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = await zip.files[name]!.async("string");

      // Text and attribute values (authors, sheet names, link targets), never tag names, so a needle like
      // "table" cannot hit markup.
      views.push(...xmlTexts(xml));
    }
  }

  return views;
}

/** The needles (3 characters or more, case-insensitive) that are still present in the copy. */
export async function residue(input: DocumentResidueInput): Promise<string[]> {
  const needles = input.needles.filter((needle) => normalizeText(needle).length >= RESIDUE_MIN_NEEDLE);

  if (needles.length === 0) {
    return [];
  }

  let views: string[];

  if (input.format === "pdf") {
    views = [...(await pdfjsTexts(input.bytes)), ...rawViews(input.bytes)];
  } else {
    views = await ooxmlViews(input.bytes);
  }

  // A needle counts only as a whole word: "ann" is not found in "planning".
  const found = needles.filter((needle) => {
    const lower = normalizeText(needle);

    return views.some((view) => containsWord(view, lower));
  });

  return [...new Set(found)];
}
