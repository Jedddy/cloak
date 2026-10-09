import type { DocumentLayer } from "@/lib/contract/interfaces";

import { withOcr } from "./ocr";
import { extractOoxml, ooxmlImages } from "./ooxml";
import { extractPdf, pdfImages, renderPdfPage } from "./pdf";
import { redactPdf } from "./pdf-redact";
import { residue } from "./residue";

// The document layer: PDF and Office extraction, redaction, and the residue
// check (KTD1). lib/server/layers.ts picks this bundle; nothing else imports
// lib/document.

function notImplemented(): never {
  throw new Error("Not implemented yet.");
}

export const documentLayer: DocumentLayer = {
  extract: (input) => (input.format === "pdf" ? extractPdf(input) : extractOoxml(input)),
  images: (input) => (input.format === "pdf" ? pdfImages(input) : ooxmlImages(input)),
  withOcr,
  renderPage: renderPdfPage,
  redact: (input) => (input.format === "pdf" ? redactPdf(input) : notImplemented()),
  residue,
};
