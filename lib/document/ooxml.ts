import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import JSZip from "jszip";

import type { DocumentExtractInput, DocumentImageBytes } from "@/lib/contract/interfaces";
import type { DocumentModel, DocumentSection, HiddenItem } from "@/lib/contract/schemas";

import { extractDocx } from "./docx";
import { extractPptx } from "./pptx";
import { emptyModel, shortHash } from "./shared";
import { extractXlsx } from "./xlsx";

// Shared OOXML plumbing for DOCX, XLSX and PPTX zip parts,
// XML, relationships, the model builder, and the inventory every format
// shares (metadata, images, objects Cloak cannot read, signatures).

const unreadable = "The document cannot be read.";

/** Compares part paths so that header2 sorts before header10. */
export const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

export type Pkg = {
  zip: JSZip;
  /** Part paths in natural order (header2 before header10). */
  names: string[];
  /** A parsed XML part, or null when the package has no such part. */
  xml: (path: string) => Promise<Document | null>;
};

export function parseXml(text: string): Document {
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        throw new Error(message);
      }
    },
  });

  return parser.parseFromString(text.replace(/^\uFEFF/, ""), "text/xml");
}

export function serializeXml(document: Document): string {
  return new XMLSerializer().serializeToString(document);
}

export async function loadPackage(bytes: Uint8Array): Promise<Pkg> {
  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(unreadable);
  }

  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort(natural);

  const cache = new Map<string, Document>();

  return {
    zip,
    names,
    xml: async (path) => {
      const cached = cache.get(path);

      if (cached) {
        return cached;
      }

      const file = zip.file(path);

      if (!file) {
        return null;
      }

      try {
        const document = parseXml(await file.async("string"));

        cache.set(path, document);

        return document;
      } catch {
        throw new Error(unreadable);
      }
    },
  };
}

/** A part that every document of its format must have. */
export async function requiredXml(pkg: Pkg, path: string): Promise<Document> {
  const document = await pkg.xml(path);

  if (!document) {
    throw new Error(unreadable);
  }

  return document;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** `root` (or a document's root element) and all elements under it, in document order. */
export function elementsOf(root: Document | Element): Element[] {
  const out: Element[] = [];
  const first = "documentElement" in root ? root.documentElement : root;
  const stack: Node[] = first ? [first] : [];

  while (stack.length > 0) {
    const node = stack.pop();

    if (!node) {
      continue;
    }

    if (isElement(node)) {
      out.push(node);
    }

    for (let child = node.lastChild; child; child = child.previousSibling) {
      stack.push(child);
    }
  }

  return out;
}

/**
 * Elements with these qualified names (for example `w:t`), in document order.
 * The redactor re-parses a part and calls this with the same names, so the
 * indexes stored in `DocumentSegment.node` line up.
 */
export function textNodes(root: Document | Element, names: string[]): Element[] {
  return elementsOf(root).filter((element) => names.includes(element.nodeName));
}

/** Descendant elements (excluding `root` itself) with this local name, in document order. */
export function descendants(root: Document | Element, localName: string): Element[] {
  const start = "documentElement" in root ? root.documentElement : root;

  return elementsOf(root).filter((element) => element !== start && element.localName === localName);
}

/** Child elements, only those with this local name when given. */
export function children(parent: Node, localName?: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => isElement(node) && (localName === undefined || node.localName === localName),
  );
}

export function attr(element: Element, name: string): string | null {
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export type Relationship = {
  id: string;
  type: string;
  /** Zip path for internal targets, the raw target for external ones. */
  target: string;
  external: boolean;
};

/** The `.rels` part of a part ("" for the package-level `_rels/.rels`). */
export function relsPathOf(part: string): string {
  const slash = part.lastIndexOf("/");

  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** The part a `.rels` part describes; "" for the package-level one. */
export function ownerOf(relsPart: string): string {
  const match = /^(.*)_rels\/(.*)\.rels$/.exec(relsPart);

  return match ? `${match[1]}${match[2]}` : "";
}

function resolvePath(directory: string, target: string): string {
  const parts = target.startsWith("/") ? [] : directory.split("/").filter(Boolean);

  for (const segment of target.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== "." && segment !== "") {
      parts.push(segment);
    }
  }

  return parts.join("/");
}

/** Relationships of a part; use "" for the package-level `_rels/.rels`. */
export async function relationships(pkg: Pkg, part: string): Promise<Relationship[]> {
  const slash = part.lastIndexOf("/");
  const directory = part.slice(0, slash + 1);
  const document = await pkg.xml(relsPathOf(part));

  if (!document) {
    return [];
  }

  return descendants(document, "Relationship").map((element) => {
    const target = element.getAttribute("Target") ?? "";
    const type = element.getAttribute("Type") ?? "";
    const external = element.getAttribute("TargetMode") === "External" || type.endsWith("/attachedTemplate");

    return {
      id: element.getAttribute("Id") ?? "",
      type,
      target: external ? target : resolvePath(directory, target),
      external,
    };
  });
}

/** Content type of a part: its Override, else the Default for its extension. */
export async function contentType(pkg: Pkg, part: string): Promise<string | null> {
  const document = await pkg.xml("[Content_Types].xml");

  if (!document) {
    return null;
  }

  const override = descendants(document, "Override").find((element) => element.getAttribute("PartName") === `/${part}`);

  if (override) {
    return override.getAttribute("ContentType");
  }

  const extension = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
  const fallback = descendants(document, "Default").find((element) => element.getAttribute("Extension")?.toLowerCase() === extension);

  return fallback?.getAttribute("ContentType") ?? null;
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

/** A text node (or whole cell) of an item. */
export type Piece = { text: string; part: string; node: number; cell?: string };

/**
 * Reads the pieces of text nodes under any element of `root`, numbered by their index among all `names` nodes of `root`.
 * `read` narrows which of those nodes make pieces (default all), for parts whose other nodes are read apart.
 */
export function pieceReader(root: Document | Element, names: string[], part: string, read: string[] = names): (scope: Document | Element) => Piece[] {
  const index = new Map(textNodes(root, names).map((node, at) => [node, at]));

  return (scope) => textNodes(scope, read).map((node) => ({ text: node.textContent ?? "", part, node: index.get(node) ?? -1 }));
}

export type ModelBuilder = {
  model: DocumentModel;
  /** Sections join the model when their first item arrives, so empty ones never show. */
  section: (title: string, kind: "flow" | "grid", hidden?: boolean) => DocumentSection;
  /** Items are joined by newlines, sections by blank lines. `gap` goes between pieces. */
  item: (section: DocumentSection, label: string, row: number | null, col: number | null, pieces: Piece[], gap?: string) => void;
  /** Adds a hidden item unless one with the same id exists. */
  hide: (item: HiddenItem) => void;
};

export function createBuilder(format: DocumentModel["format"]): ModelBuilder {
  const model = emptyModel(format);

  return {
    model,
    section: (title, kind, hidden = false) => ({ title, kind, hidden, page: null, items: [] }),
    item: (section, label, row, col, pieces, gap = "") => {
      const used = pieces.filter((piece) => piece.text !== "");

      if (used.length === 0) {
        return;
      }

      if (section.items.length === 0) {
        model.sections.push(section);
        model.text += model.text === "" ? "" : "\n\n";
      } else {
        model.text += "\n";
      }

      const start = model.text.length;

      used.forEach((piece, index) => {
        if (index > 0) {
          model.text += gap;
        }

        const from = model.text.length;

        model.text += piece.text;
        model.segments.push({ start: from, end: model.text.length, part: piece.part, node: piece.node, cell: piece.cell ?? null });
      });
      section.items.push({ start, end: model.text.length, label, row, col });
    },
    hide: (item) => {
      if (!model.hidden.some((existing) => existing.id === item.id)) {
        model.hidden.push(item);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared inventory
// ---------------------------------------------------------------------------

const imageMimes = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
]);

export type ObjectKind = "Chart" | "SmartArt" | "Embedded object";

const objectReasons: Record<ObjectKind, string> = {
  Chart: "Chart contents are not read",
  SmartArt: "SmartArt text is not read",
  "Embedded object": "Embedded objects are not opened",
};

/** The kind of chart, SmartArt data or embedded object a part is, or null for any other part. */
export function objectKind(path: string): ObjectKind | null {
  const base = path.slice(path.lastIndexOf("/") + 1);

  if (path.includes("/charts/") && /^chart[^/]*\.xml$/.test(base)) {
    return "Chart";
  }

  if (path.includes("/diagrams/") && /^data[^/]*\.xml$/.test(base)) {
    return "SmartArt";
  }

  return path.includes("/embeddings/") ? "Embedded object" : null;
}

function firstText(document: Document | null, localName: string): string {
  if (!document) {
    return "";
  }

  return descendants(document, localName)[0]?.textContent?.trim() ?? "";
}

async function inventory(pkg: Pkg, builder: ModelBuilder): Promise<void> {
  const { model } = builder;
  const core = await pkg.xml("docProps/core.xml");
  const app = await pkg.xml("docProps/app.xml");
  const author = firstText(core, "creator");
  const modifiedBy = firstText(core, "lastModifiedBy");

  const fields: [string, string][] = [
    ["author", author],
    ["last modified by", modifiedBy],
    ["title", firstText(core, "title")],
    ["subject", firstText(core, "subject")],
    ["company", firstText(app, "Company")],
    ["manager", firstText(app, "Manager")],
  ];

  const notes = fields.flatMap(([name, value]) => (value === "" ? [] : [`${name} '${value}'`]));

  if (pkg.names.includes("docProps/custom.xml")) {
    notes.push("custom properties");
  }

  if (pkg.names.some((name) => name.startsWith("customXml/"))) {
    notes.push("custom XML data");
  }

  if (notes.length > 0) {
    builder.hide({
      id: "metadata",
      kind: "metadata",
      note: `Document properties: ${notes.join(", ")}`,
      quote: author || modifiedBy || null,
      category: "metadata",
    });
  }

  for (const name of pkg.names) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const extension = base.slice(base.lastIndexOf(".") + 1).toLowerCase();
    const kind = objectKind(name);

    if (name.includes("/media/")) {
      const mime = imageMimes.get(extension);

      if (mime) {
        model.images.push({ id: name, label: `Image: ${name}`, mime, page: null });
      } else {
        model.notAnalysed.push({ label: `Image: ${name}`, reason: "Image format not analysed" });
      }
    } else if (kind) {
      model.notAnalysed.push({ label: `${kind} ${name}`, reason: objectReasons[kind] });
    } else if (base === "vbaProject.bin") {
      model.notAnalysed.push({ label: `Macros ${name}`, reason: "Macro code is not read" });
    } else if (name.startsWith("_xmlsignatures/")) {
      model.signed = true;
    }
  }

  const relParts = pkg.names.filter((name) => name.endsWith(".rels") && !name.startsWith("xl/externalLinks/"));

  for (const relsPart of relParts) {
    const rels = await relationships(pkg, ownerOf(relsPart));

    for (const rel of rels.filter((entry) => entry.external)) {
      const host = hostOf(rel.target);

      builder.hide({
        id: `link-${shortHash(rel.target)}`,
        kind: "external-link",
        note: `Link to ${host || rel.target}`,
        quote: host || rel.target,
        category: "hidden-data",
      });
    }
  }
}

export function hostOf(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    return "";
  }
}

export async function extractOoxml(input: DocumentExtractInput): Promise<DocumentModel> {
  const pkg = await loadPackage(input.bytes);
  const builder = createBuilder(input.format);

  if (input.format === "docx") {
    await extractDocx(pkg, builder);
  } else if (input.format === "xlsx") {
    await extractXlsx(pkg, builder);
  } else if (input.format === "pptx") {
    await extractPptx(pkg, builder);
  } else {
    throw new Error(unreadable);
  }

  await inventory(pkg, builder);

  return builder.model;
}

export async function ooxmlImages(input: DocumentExtractInput & { model: DocumentModel }): Promise<DocumentImageBytes[]> {
  const pkg = await loadPackage(input.bytes);
  const out: DocumentImageBytes[] = [];

  for (const image of input.model.images) {
    const file = pkg.zip.file(image.id);

    if (file) {
      out.push({ id: image.id, mime: image.mime, bytes: await file.async("uint8array") });
    }
  }

  return out;
}
