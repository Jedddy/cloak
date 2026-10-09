import * as mupdf from "mupdf";

// Fixture builder for PDF tests (fictional data only). Pure: no file I/O.

export type PdfPageSpec = {
  /** Helvetica text lines, top to bottom. */
  lines?: string[];
  /** Draw `lines` with a hand-written Type3 font (glyphs are filled squares). */
  type3?: boolean;
  /** Put a picture on the page (a text page with an image, or an image-only page when `lines` is empty). */
  image?: boolean;
  /** Sticky-note annotation. */
  note?: { author: string; contents: string };
  /** URI link over the first line. */
  link?: string;
};

export type PdfOptions = {
  pages: PdfPageSpec[];
  info?: Record<string, string>;
  xmp?: string;
  attachment?: { name: string; text: string };
};

const PAGE_RECT: mupdf.Rect = [0, 0, 612, 792];

/** Builds a small PDF with mupdf. */
export function buildPdf(options: PdfOptions): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const helvetica = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" });
  let type3Font: mupdf.PDFObject | null = null;
  let imageRef: mupdf.PDFObject | null = null;

  options.pages.forEach((spec, index) => {
    const xobjects: Record<string, mupdf.PDFObject> = {};
    let font = helvetica;
    let content = "";

    if (spec.type3) {
      if (!type3Font) {
        const glyph = doc.addStream("1000 0 0 0 750 750 d1 0 0 750 750 re f", {});
        type3Font = doc.addObject({
          Type: "Font",
          Subtype: "Type3",
          FontBBox: [0, 0, 1000, 1000],
          FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
          CharProcs: { a: glyph, b: glyph },
          Encoding: { Type: "Encoding", Differences: [97, "a", "b"] },
          FirstChar: 97,
          LastChar: 98,
          Widths: [1000, 1000],
        });
      }

      font = type3Font;
    }

    if (spec.image) {
      if (!imageRef) {
        const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 60, 40], false);
        pixmap.clear(180);
        imageRef = doc.addImage(new mupdf.Image(pixmap.asPNG()));
      }

      xobjects.Im1 = imageRef;
      content += "q 240 0 0 160 72 400 cm /Im1 Do Q\n";
    }

    const lines = spec.lines ?? [];

    if (lines.length > 0) {
      const shown = lines.map((line) => `(${line.replace(/[\\()]/g, "\\$&")}) Tj 0 -18 Td`).join(" ");

      content += `BT /F1 12 Tf 72 720 Td ${shown} ET\n`;
    }

    const page = doc.addPage(PAGE_RECT, 0, { Font: { F1: font }, XObject: xobjects }, content);

    doc.insertPage(-1, page);

    if (spec.note || spec.link) {
      const loaded = doc.loadPage(index);

      if (spec.note) {
        const annotation = loaded.createAnnotation("Text");

        annotation.setRect([300, 600, 320, 620]);
        annotation.setAuthor(spec.note.author);
        annotation.setContents(spec.note.contents);
      }

      if (spec.link) {
        loaded.createLink([72, 700, 200, 720], spec.link);
      }

      loaded.destroy();
    }
  });

  for (const [key, value] of Object.entries(options.info ?? {})) {
    doc.setMetaData(`info:${key}`, value);
  }

  if (options.xmp) {
    const stream = doc.addStream(options.xmp, { Type: "Metadata", Subtype: "XML" });

    doc.getTrailer().get("Root").put("Metadata", stream);
  }

  if (options.attachment) {
    const bytes = new TextEncoder().encode(options.attachment.text);

    doc.insertEmbeddedFile(
      options.attachment.name,
      doc.addEmbeddedFile(options.attachment.name, "text/plain", bytes, new Date(0), new Date(0)),
    );
  }

  const bytes = doc.saveToBuffer("compress").asUint8Array().slice();

  doc.destroy();

  return bytes;
}

/** A PDF with the given text on page 1, encrypted with AES-256 and a user password. */
export function buildEncryptedPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument(buildPdf({ pages: [{ lines: ["Secret"] }] }));
  const bytes = doc.saveToBuffer("encrypt=aes-256,user-password=open,owner-password=owner").asUint8Array().slice();

  doc.destroy();

  return bytes;
}
