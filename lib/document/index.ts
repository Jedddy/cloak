import type { DocumentLayer } from "@/lib/contract/interfaces";

// The document layer: PDF and Office extraction, redaction, and the residue
// check (KTD1). Later units replace the placeholder bodies below.

function notImplemented(): never {
  throw new Error("Not implemented yet.");
}

export const documentLayer: DocumentLayer = {
  extract: async () => notImplemented(),
  images: async () => notImplemented(),
  withOcr: (input) => input.model,
  renderPage: async () => notImplemented(),
  redact: async () => notImplemented(),
  residue: async () => [],
};
