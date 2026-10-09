import { createHash } from "node:crypto";
import * as mupdf from "mupdf";

import type { DocumentExtractInput, DocumentImageBytes } from "@/lib/contract/interfaces";
import { PAGE_SCALE } from "@/lib/contract/schemas";
import type { Box, DocumentModel, DocumentSection, DocumentWord, HiddenItem } from "@/lib/contract/schemas";

// PDF extraction and page rendering with MuPDF (KTD3, KTD9). Word boxes are in
// render pixels: page points minus the page origin, times PAGE_SCALE.

export type Own = <D extends { destroy(): void }>(item: D) => D;

/** Runs `run` and destroys every MuPDF object it registered with `own`, even when it throws. */
export function scoped<T>(run: (own: Own) => T): T {
  const owned: { destroy(): void }[] = [];

  try {
    return run((item) => {
      owned.push(item);

      return item;
    });
  } finally {
    for (const item of owned.reverse()) {
      item.destroy();
    }
  }
}

export function openPdf(bytes: Uint8Array, own: Own): mupdf.PDFDocument {
  let pdf: mupdf.PDFDocument | null = null;

  try {
    pdf = own(mupdf.Document.openDocument(bytes, "application/pdf")).asPDF();
  } catch {
    pdf = null;
  }

  if (!pdf || pdf.countPages() === 0) {
    throw new Error("The document cannot be read.");
  }

  if (pdf.needsPassword()) {
    throw new Error("Encrypted PDF");
  }

  return pdf;
}

export function hiddenId(kind: HiddenItem["kind"], ...parts: string[]): string {
  return `${kind}-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 12)}`;
}

const INFO_FIELDS = ["Author", "Creator", "Producer", "Title", "Subject", "Keywords"];

export type PdfWord = { text: string; x0: number; y0: number; x1: number; y1: number; size: number };

export function pageWords(page: mupdf.PDFPage, own: Own) {
  const lines: PdfWord[][] = [];
  let line: PdfWord[] = [];
  let word: PdfWord | null = null;
  let imageBlocks = 0;

  const endWord = () => {
    if (word) {
      line.push(word);
    }

    word = null;
  };

  const endLine = () => {
    endWord();

    if (line.length > 0) {
      lines.push(line);
    }

    line = [];
  };

  own(page.toStructuredText("preserve-whitespace,preserve-images,clip=no")).walk({
    onImageBlock: () => {
      imageBlocks += 1;
    },
    beginLine: endLine,
    endLine,
    onChar: (c, _origin, _font, size, quad) => {
      if (/\s/.test(c)) {
        endWord();

        return;
      }

      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];

      word ??= { text: "", x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, size };
      word.text += c;
      word.x0 = Math.min(word.x0, ...xs);
      word.y0 = Math.min(word.y0, ...ys);
      word.x1 = Math.max(word.x1, ...xs);
      word.y1 = Math.max(word.y1, ...ys);
    },
  });
  endLine();

  return { lines, hasImageBlock: imageBlocks > 0 };
}

/** True for text outside the page bounds or in a font too small to see. */
export function isHiddenWord(word: PdfWord, [left, top, right, bottom]: mupdf.Rect): boolean {
  const outside = word.x1 <= left || word.x0 >= right || word.y1 <= top || word.y0 >= bottom;

  return outside || word.size < 1;
}

/** The host of an http(s) link, or "" for anything else. */
export function linkHost(uri: string): string {
  try {
    const url = new URL(uri);

    return /^https?:$/.test(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}

function outlineTitles(items: ReturnType<mupdf.Document["loadOutline"]>): string[] {
  return (items ?? []).flatMap((item) => [item.title?.trim() ?? "", ...outlineTitles(item.down ?? [])]).filter(Boolean);
}

/** Reads text with word boxes, per-page facts, and hidden content from a PDF. */
export async function extractPdf(input: DocumentExtractInput): Promise<DocumentModel> {
  return scoped((own) => {
    const doc = openPdf(input.bytes, own);
    const root = doc.getTrailer().get("Root");
    const hidden = new Map<string, HiddenItem>();

    const addHidden = (item: Omit<HiddenItem, "category"> & { category?: HiddenItem["category"] }) => {
      hidden.set(item.id, { category: "hidden-data", ...item });
    };

    const model: DocumentModel = {
      format: "pdf",
      text: "",
      sections: [],
      segments: [],
      words: [],
      hidden: [],
      images: [],
      notAnalysed: [],
      signed: false,
      pages: [],
    };

    const startSection = () => {
      if (model.text) {
        model.text += "\n\n";
      }
    };

    for (let index = 0; index < doc.countPages(); index += 1) {
      const number = index + 1;
      const page = own(doc.loadPage(index));
      const [left, top, right, bottom] = page.getBounds();
      const { lines, hasImageBlock } = pageWords(page, own);
      const section: DocumentSection = { title: `Page ${number}`, kind: "page", hidden: false, page: number, items: [] };
      const offPage: string[] = [];
      const start = (startSection(), model.text.length);

      lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          model.text += "\n";
        }

        line.forEach((word, wordIndex) => {
          if (wordIndex > 0) {
            model.text += " ";
          }

          const box: Box = {
            x: Math.max(0, (word.x0 - left) * PAGE_SCALE),
            y: Math.max(0, (word.y0 - top) * PAGE_SCALE),
            w: Math.max(0.1, (word.x1 - word.x0) * PAGE_SCALE),
            h: Math.max(0.1, (word.y1 - word.y0) * PAGE_SCALE),
          };

          if (isHiddenWord(word, [left, top, right, bottom])) {
            offPage.push(word.text);
          }

          model.words.push({
            text: word.text,
            start: model.text.length,
            end: model.text.length + word.text.length,
            anchor: `page:${number}`,
            box,
          } satisfies DocumentWord);
          model.text += word.text;
        });
      });

      section.items.push({ start, end: model.text.length, label: section.title, row: null, col: null });
      model.sections.push(section);

      const resources = page.getObject().getInheritable("Resources");
      let type3 = false;
      let hasImages = hasImageBlock;

      resources.get("Font").forEach((font) => {
        type3 ||= font.get("Subtype").isName() && font.get("Subtype").asName() === "Type3";
      });
      resources.get("XObject").forEach((xobject) => {
        hasImages ||= xobject.get("Subtype").isName() && xobject.get("Subtype").asName() === "Image";
      });

      const hasTextLayer = lines.length > 0;

      model.pages.push({ width: (right - left) * PAGE_SCALE, height: (bottom - top) * PAGE_SCALE, hasTextLayer, type3, hasImages });

      if (!hasTextLayer || hasImages) {
        model.images.push({ id: `p${number}`, label: section.title, mime: "image/png", page: number });
      }

      if (offPage.length > 0) {
        const quote = offPage.join(" ").slice(0, 200);

        addHidden({
          id: hiddenId("off-page-text", String(number), quote),
          kind: "off-page-text",
          note: `Text outside the visible page on page ${number}`,
          quote,
        });
      }

      for (const widget of page.getWidgets().map(own)) {
        const field = widget.getObject().getInheritable("FT");
        const value = widget.getValue();

        if (field.isName() && field.asName() === "Sig") {
          model.signed ||= !widget.getObject().getInheritable("V").isNull();
        } else if (value && value !== "Off") {
          addHidden({
            id: hiddenId("form-field", widget.getName(), value),
            kind: "form-field",
            note: `Form field '${widget.getName()}' value '${value}'`,
            quote: value,
          });
        }
      }

      for (const annotation of page.getAnnotations().map(own)) {
        const type = annotation.getType();

        if (type === "Link" || type === "Popup" || type === "Widget") {
          continue;
        }

        const author = annotation.getAuthor();
        const contents = annotation.getContents();

        addHidden({
          id: hiddenId("annotation", String(number), type, author, contents),
          kind: "annotation",
          note: `Comment by ${author || "an unknown author"} on page ${number}: '${contents.slice(0, 60)}'`,
          quote: author || null,
        });
      }

      for (const link of page.getLinks().map(own)) {
        const host = linkHost(link.getURI());

        if (host) {
          addHidden({ id: hiddenId("external-link", host), kind: "external-link", note: `Link to ${host}`, quote: host });
        }
      }
    }

    const outline = outlineTitles(doc.loadOutline());

    if (outline.length > 0) {
      startSection();
      const section: DocumentSection = { title: "Bookmarks", kind: "flow", hidden: false, page: null, items: [] };

      outline.forEach((title, titleIndex) => {
        if (titleIndex > 0) {
          model.text += "\n";
        }

        section.items.push({ start: model.text.length, end: model.text.length + title.length, label: title, row: null, col: null });
        model.text += title;
      });
      model.sections.push(section);
    }

    const info = INFO_FIELDS.flatMap((field) => {
      const value = doc.getMetaData(`info:${field}`);

      return value ? [[field, value]] : [];
    });

    const xmp = root.get("Metadata");
    const author = info.find(([field]) => field === "Author")?.[1] ?? null;

    if (info.length > 0 || xmp.isStream()) {
      const xmpText = xmp.isStream() ? new TextDecoder().decode(xmp.readStream().asUint8Array()) : "";

      addHidden({
        id: hiddenId("metadata", ...info.flat(), xmpText),
        kind: "metadata",
        note: `Document properties: ${[...info.map(([field]) => field), ...(xmpText ? ["XMP"] : [])].join(", ")}`,
        quote: author,
        category: "metadata",
      });
    }

    for (const name of Object.keys(doc.getEmbeddedFiles())) {
      addHidden({ id: hiddenId("attachment", name), kind: "attachment", note: `Attached file '${name}'`, quote: name });
    }

    const openAction = root.get("OpenAction");

    const runsScript =
      !root.get("Names", "JavaScript").isNull() ||
      (openAction.isDictionary() && openAction.get("S").isName() && openAction.get("S").asName() === "JavaScript");

    if (runsScript) {
      addHidden({ id: hiddenId("javascript"), kind: "javascript", note: "The document contains JavaScript", quote: null });
    }

    root.get("OCProperties", "D", "OFF").forEach((group) => {
      const name = group.get("Name").isString() ? group.get("Name").asString() : "";

      addHidden({
        id: hiddenId("hidden-layer", name),
        kind: "hidden-layer",
        note: `Hidden layer '${name}'`,
        quote: name || null,
      });
    });

    model.hidden = [...hidden.values()];

    return model;
  });
}

function renderPage(doc: mupdf.PDFDocument, page: number, own: Own): Uint8Array {
  if (!Number.isInteger(page) || page < 1 || page > doc.countPages()) {
    throw new Error("No such page.");
  }

  const pixmap = own(
    own(doc.loadPage(page - 1)).toPixmap(mupdf.Matrix.scale(PAGE_SCALE, PAGE_SCALE), mupdf.ColorSpace.DeviceRGB, false, true),
  );

  return pixmap.asPNG().slice();
}

/** A PNG of one page (1-based) at PAGE_SCALE. */
export async function renderPdfPage(input: { bytes: Uint8Array; page: number }): Promise<Uint8Array> {
  return scoped((own) => renderPage(openPdf(input.bytes, own), input.page, own));
}

/** PNG renders for every model image entry (pages that need OCR or vision). */
export async function pdfImages(input: DocumentExtractInput & { model: DocumentModel }): Promise<DocumentImageBytes[]> {
  return scoped((own) => {
    const doc = openPdf(input.bytes, own);

    return input.model.images.map((image) => ({
      id: image.id,
      mime: image.mime,
      bytes: renderPage(doc, image.page ?? 0, own),
    }));
  });
}
