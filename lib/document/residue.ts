import type { DocumentResidueInput } from "@/lib/contract/interfaces";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Independent residue check (KTD6): searches a reviewed copy for text that
// should be gone, using pdfjs (not MuPDF) and a raw look at every stream.

const MIN_NEEDLE = 3;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const XML_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeEntities(xml: string): string {
  return xml.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex, dec, name) => {
    if (name) {
      return XML_ENTITIES.get(name.toLowerCase()) ?? "";
    }

    return String.fromCodePoint(Number.parseInt(hex ?? dec, hex ? 16 : 10));
  });
}

async function pdfjsTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });

  try {
    const doc = await task.promise;
    const texts: string[] = [];

    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const items = (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : []));

      texts.push(normalize(items.join(" ")), normalize(items.join("")));
    }

    return texts;
  } finally {
    await task.destroy();
  }
}

/** Latin-1 views of the raw file, every stream (inflated when it inflates), and their hex strings and #xx-escaped names decoded. */
function rawViews(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const views = [raw];

  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = Buffer.from(match[1]!, "latin1");

    try {
      views.push(inflateSync(body).toString("latin1"));
    } catch {
      views.push(match[1]!);
    }
  }

  for (const view of [...views]) {
    const hex = [...view.matchAll(/<([0-9a-fA-F\s]{6,})>/g)].map((m) => Buffer.from(m[1]!.replace(/\s/g, ""), "hex").toString("latin1"));

    views.push(hex.join("\n"), view.replace(/#([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16))));
  }

  return views.map((view) => view.toLowerCase());
}

async function ooxmlViews(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const views: string[] = [];

  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = await zip.files[name]!.async("string");

      // Text and attribute values (authors, sheet names, link targets), never tag names, so a needle like
      // "table" cannot hit markup.
      const values = [...xml.matchAll(/="([^"]*)"|='([^']*)'/g)].map((match) => match[1] ?? match[2]);

      views.push(normalize(decodeEntities(xml.replace(/<[^>]*>/g, ""))), normalize(decodeEntities(values.join("\n"))));
    }
  }

  return views;
}

/** The needles (3 characters or more, case-insensitive) that are still present in the copy. */
export async function residue(input: DocumentResidueInput): Promise<string[]> {
  const needles = input.needles.filter((needle) => normalize(needle).length >= MIN_NEEDLE);

  if (needles.length === 0) {
    return [];
  }

  let views: string[];
  let encodings: (needle: string) => string[];

  if (input.format === "pdf") {
    views = [...(await pdfjsTexts(input.bytes)), ...rawViews(input.bytes)];
    encodings = (needle) => [needle, Buffer.from(needle, "utf16le").swap16().toString("latin1")];
  } else {
    views = await ooxmlViews(input.bytes);
    encodings = (needle) => [needle];
  }

  const found = needles.filter((needle) => {
    const lower = normalize(needle);

    return encodings(lower).some((encoded) => views.some((view) => view.includes(encoded)));
  });

  return [...new Set(found)];
}
