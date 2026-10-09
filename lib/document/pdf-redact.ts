import * as mupdf from "mupdf";

import type { DocumentRedactionInput, DocumentRedactionResult } from "@/lib/contract/interfaces";
import { PAGE_SCALE, pageOfAnchor } from "@/lib/contract/schemas";
import type { Box, DocumentWord } from "@/lib/contract/schemas";
import { padBox, paintBox } from "@/lib/redact/image";

import {
  hiddenId,
  isCommentAnnotation,
  isHiddenWord,
  isJavaScriptAction,
  isSignatureField,
  layerName,
  linkHost,
  openPdf,
  pageWords,
  scoped,
} from "./pdf";
import { appendTo } from "./shared";

// PDF redaction (KTD3, KTD4, KTD10): MuPDF Redact annotations remove the text,
// image pixels and line art under each box. A page whose text survives, or that
// uses a Type3 font, is replaced by a painted render of the original page.

const REDACT_PADDING_PT = 1;

/** Removes every entry that points at one of `nums` from an array, searching nested arrays. */
function dropRefs(array: mupdf.PDFObject, nums: Set<number>): void {
  if (!array.isArray()) {
    return;
  }

  for (let index = array.length - 1; index >= 0; index -= 1) {
    const item = array.get(index);

    if (item.isIndirect() && nums.has(item.asIndirect())) {
      array.delete(index);
    } else if (item.isArray()) {
      dropRefs(item, nums);
    } else if (item.isDictionary() && item.get("Kids").isArray()) {
      dropRefs(item.get("Kids"), nums);
    }
  }
}

/** True when a resources dictionary, or a form XObject inside it, uses one of the optional-content groups. */
function usesLayer(resources: mupdf.PDFObject, nums: Set<number>, seen = new Set<number>()): boolean {
  let used = false;

  resources.get("Properties").forEach((group) => {
    used ||= group.isIndirect() && nums.has(group.asIndirect());
  });
  resources.get("XObject").forEach((xobject) => {
    const layer = xobject.get("OC");
    const id = xobject.isIndirect() ? xobject.asIndirect() : -1;

    used ||= layer.isIndirect() && nums.has(layer.asIndirect());

    if (!used && !seen.has(id)) {
      seen.add(id);
      used = usesLayer(xobject.get("Resources"), nums, seen);
    }
  });

  return used;
}

/** Writes a reviewed copy of a PDF: text and pixels under the evidence removed, hidden items dropped, metadata stripped. */
export async function redactPdf(input: DocumentRedactionInput): Promise<DocumentRedactionResult> {
  return scoped((own) => {
    const doc = openPdf(input.bytes, own);
    const root = doc.getTrailer().get("Root");
    const remove = new Set(input.removeHidden);
    const pageCount = doc.countPages();
    const bounds = Array.from({ length: pageCount }, (_, index) => scoped((o) => o(doc.loadPage(index)).getBounds()));
    // Per page index: boxes in page points, and why the page is flattened.
    const rects = new Map<number, mupdf.Rect[]>();
    const flatten = new Map<number, "text" | "layer">();

    const addRect = (index: number, rect: mupdf.Rect) => appendTo(rects, index, rect);

    const addBox = (index: number, box: Box) => {
      const [left, top, right, bottom] = bounds[index]!;

      // Clamped to the page, so a box meant to cover everything stays a sane rectangle.
      addRect(index, [
        Math.min(right, left + box.x / PAGE_SCALE),
        Math.min(bottom, top + box.y / PAGE_SCALE),
        Math.min(right, left + (box.x + box.w) / PAGE_SCALE),
        Math.min(bottom, top + (box.y + box.h) / PAGE_SCALE),
      ]);
    };

    // Text spans become the boxes of the words they overlap; anchored regions are used as-is.
    const pageIndexed = input.model.words.flatMap((word) => {
      const page = pageOfAnchor(word.anchor);

      return page === null ? [] : [{ index: page - 1, word }];
    });

    for (const span of input.spans) {
      const byPage = new Map<number, DocumentWord[]>();

      for (const { index, word } of pageIndexed) {
        if (word.start < span.end && word.end > span.start) {
          appendTo(byPage, index, word);
        }
      }

      for (const [index, words] of byPage) {
        words.forEach((word) => addBox(index, word.box));
      }
    }

    for (const region of input.regions) {
      const page = pageOfAnchor(region.anchor);

      if (page !== null && page <= pageCount) {
        addBox(page - 1, region.box);
      }
    }

    // Bookmarks have no words: a span over their text removes the outline.
    const bookmarks = input.model.sections.find((section) => section.title === "Bookmarks");

    if (bookmarks?.items.some((item) => input.spans.some((span) => item.start < span.end && item.end > span.start))) {
      root.delete("Outlines");
    }

    // Hidden items, found again by the ids pdf.ts derived.
    const widgetNums = new Set<number>();
    const scanPages = remove.size === 0 ? 0 : pageCount;

    for (let index = 0; index < scanPages; index += 1) {
      scoped((o) => {
        const page = o(doc.loadPage(index));
        const number = index + 1;

        for (const widget of page.getWidgets().map(o)) {
          const field = widget.getObject().getInheritable("FT");
          const value = widget.getValue();
          const id = hiddenId("form-field", widget.getName(), value);

          if (!isSignatureField(field) && value && value !== "Off" && remove.has(id)) {
            widgetNums.add(widget.getObject().asIndirect());
            page.deleteAnnotation(widget);
          }
        }

        for (const annotation of page.getAnnotations().map(o)) {
          const type = annotation.getType();

          if (isCommentAnnotation(type)) {
            const id = hiddenId("annotation", String(number), type, annotation.getAuthor(), annotation.getContents());

            if (remove.has(id)) {
              page.deleteAnnotation(annotation);
            }
          }
        }

        for (const link of page.getLinks().map(o)) {
          const host = linkHost(link.getURI());

          if (host && remove.has(hiddenId("external-link", host))) {
            page.deleteLink(link);
          }
        }

        const offPage = pageWords(page, o)
          .lines.flat()
          .filter((word) => isHiddenWord(word, bounds[index]!));

        const quote = offPage
          .map((word) => word.text)
          .join(" ")
          .slice(0, 200);

        if (offPage.length > 0 && remove.has(hiddenId("off-page-text", String(number), quote))) {
          for (const word of offPage) {
            addRect(index, [word.x0, word.y0, word.x1, word.y1]);
          }
        }
      });
    }

    dropRefs(root.get("AcroForm", "Fields"), widgetNums);

    for (const name of Object.keys(doc.getEmbeddedFiles())) {
      if (remove.has(hiddenId("attachment", name))) {
        doc.deleteEmbeddedFile(name);
      }
    }

    if (remove.has(hiddenId("javascript"))) {
      if (root.get("Names").isDictionary()) {
        root.get("Names").delete("JavaScript");
      }

      if (isJavaScriptAction(root.get("OpenAction"))) {
        root.delete("OpenAction");
      }
    }

    const layerNums = new Set<number>();

    root.get("OCProperties", "D", "OFF").forEach((group) => {
      if (group.isIndirect() && remove.has(hiddenId("hidden-layer", layerName(group)))) {
        layerNums.add(group.asIndirect());
      }
    });

    if (layerNums.size > 0) {
      for (let index = 0; index < pageCount; index += 1) {
        scoped((o) => {
          if (usesLayer(o(doc.loadPage(index)).getObject().getInheritable("Resources"), layerNums)) {
            flatten.set(index, "layer");
          }
        });
      }

      dropRefs(root.get("OCProperties", "OCGs"), layerNums);

      for (const key of ["OFF", "ON", "Order", "RBGroups", "Locked"]) {
        dropRefs(root.get("OCProperties", "D", key), layerNums);
      }
    }

    // Native redaction, except on pages that are flattened anyway.
    for (const [index, pageRects] of rects) {
      if (input.model.pages[index]?.type3) {
        flatten.set(index, "text");
      } else if (!flatten.has(index)) {
        scoped((o) => {
          const page = o(doc.loadPage(index));

          for (const [x0, y0, x1, y1] of pageRects) {
            const pad = REDACT_PADDING_PT;

            o(page.createAnnotation("Redact")).setRect([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
          }

          page.applyRedactions(
            true,
            mupdf.PDFPage.REDACT_IMAGE_PIXELS,
            mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
            mupdf.PDFPage.REDACT_TEXT_REMOVE,
          );
        });
      }
    }

    // KTD10: a page where text survived under a redaction box is flattened. Only characters whose center lies
    // inside a box count, so the same letters in other words do not.
    for (const index of rects.keys()) {
      if (flatten.has(index)) {
        continue;
      }

      scoped((o) => {
        const pageRects = rects.get(index) ?? [];
        let survived = false;

        o(o(doc.loadPage(index)).toStructuredText("preserve-whitespace,clip=no")).walk({
          onChar: (c, _origin, _font, _size, quad) => {
            const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
            const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

            survived ||= !/\s/.test(c) && pageRects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
          },
        });

        if (survived) {
          flatten.set(index, "text");
        }
      });
    }

    const notes: DocumentRedactionResult["notes"] = [];

    let original: mupdf.PDFDocument | undefined;

    // The untouched copy is opened on the first flatten only.
    const originalDoc = () => (original ??= openPdf(input.bytes, own));

    for (const [index, reason] of [...flatten].sort((a, b) => a[0] - b[0])) {
      scoped((o) => {
        const source = o(originalDoc().loadPage(index));
        const [left, top, right, bottom] = source.getBounds();
        const pixmap = o(source.toPixmap(mupdf.Matrix.scale(PAGE_SCALE, PAGE_SCALE), mupdf.ColorSpace.DeviceRGB, false, false));
        const samples = pixmap.getPixels();
        const pixels = new Uint8Array(samples.buffer, samples.byteOffset, samples.length);

        for (const [x0, y0, x1, y1] of rects.get(index) ?? []) {
          const box = padBox(
            { left: (x0 - left) * PAGE_SCALE, top: (y0 - top) * PAGE_SCALE, width: (x1 - x0) * PAGE_SCALE, height: (y1 - y0) * PAGE_SCALE },
            pixmap.getWidth(),
            pixmap.getHeight(),
          );

          if (box) {
            paintBox(pixels, pixmap.getWidth(), pixmap.getNumberOfComponents(), box);
          }
        }

        const image = doc.addImage(o(new mupdf.Image(pixmap.asPNG())));
        const [width, height] = [right - left, bottom - top];
        const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

        doc.insertPage(index, doc.addPage([0, 0, width, height], 0, { XObject: { Im0: image } }, content));
        doc.deletePage(index + 1);
      });

      const why = reason === "text" ? "text could not be removed natively" : "a hidden layer was removed";

      notes.push({ kind: "flattened", note: `${input.fileName} page ${index + 1} flattened: ${why}.` });
    }

    // Metadata is always stripped (R17).
    doc.getTrailer().delete("Info");

    for (const holder of [root, ...Array.from({ length: pageCount }, (_, index) => doc.findPage(index))]) {
      for (const key of ["Metadata", "PieceInfo"]) {
        holder.delete(key);
      }
    }

    const saved = own(doc.saveToBuffer("garbage=4,compress,clean,sanitize"));

    return { bytes: saved.asUint8Array().slice(), notes };
  });
}
