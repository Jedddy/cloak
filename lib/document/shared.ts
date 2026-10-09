import { createHash } from "node:crypto";

import type { DocumentModel } from "@/lib/contract/schemas";

// Small helpers shared by the PDF and OOXML sides of the document layer.

/** The first 12 hex digits of the SHA-256 of `text`: the stable part of hidden item ids. */
export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** A model with nothing in it yet. */
export function emptyModel(format: DocumentModel["format"]): DocumentModel {
  return {
    format,
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
}

/** Adds `value` to the list under `key`, creating the list first. */
export function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);

  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
