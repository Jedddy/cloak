import type { Document, Element, Node } from "@xmldom/xmldom";

import type { DocumentSection } from "@/lib/contract/schemas";

import { attr, children, descendants, elementsOf, hostOf, pieceReader, requiredXml, textNodes, type ModelBuilder, type Pkg } from "./ooxml";
import { shortHash } from "./shared";

// DOCX extraction Text nodes are w:t and w:delText, plus field
// instructions (w:instrText, and w:fldSimple whose text is its w:instr attribute);
// a segment's `node` is the node's index in textNodes(part, docxTextNames).

export const docxTextNames = ["w:t", "w:delText", "w:instrText", "w:fldSimple"];

/** The text nodes that show in the document; field instructions are read apart. */
export const docxVisibleNames = ["w:t", "w:delText"];

const falsy = new Set(["0", "false", "off"]);

/** Paragraphs and tables under `element` in order, looking through content controls and other containers. */
function blocks(element: Node): Element[] {
  return children(element).flatMap((child) => {
    if (child.localName === "p" || child.localName === "tbl") {
      return [child];
    }

    return blocks(child);
  });
}

function hiddenRunKind(run: Element): "vanish" | "white" | "tiny" | null {
  const properties = children(run, "rPr")[0];

  if (!properties) {
    return null;
  }

  const vanish = children(properties, "vanish")[0];
  const color = children(properties, "color")[0];
  const size = children(properties, "sz")[0];

  if (vanish && !falsy.has(attr(vanish, "w:val") ?? "")) {
    return "vanish";
  }

  if (color && attr(color, "w:val")?.toUpperCase() === "FFFFFF") {
    return "white";
  }

  if (size && Number(attr(size, "w:val")) <= 2) {
    return "tiny";
  }

  return null;
}

/** A run's concealment kind, text and hidden item id; null when it is visible or has no text. */
export function hiddenRunOf(run: Element): { kind: "vanish" | "white" | "tiny"; text: string; id: string } | null {
  const kind = hiddenRunKind(run);

  const text = textNodes(run, docxVisibleNames)
    .map((node) => node.textContent)
    .join("");

  return kind && text !== "" ? { kind, text, id: `${kind}-${shortHash(text)}` } : null;
}

const propertyChanges = ["rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "trPrChange", "tcPrChange", "numberingChange"];

const moveMarkers = ["moveFromRangeStart", "moveToRangeStart"];

const trackedNotes = new Map([
  ["moveFrom", "Tracked move-from"],
  ["moveTo", "Tracked move-to"],
  ["moveFromRangeStart", "Tracked move marker"],
  ["moveToRangeStart", "Tracked move marker"],
  ["cellIns", "Tracked cell insertion"],
  ["cellDel", "Tracked cell deletion"],
]);

/**
 * Tracked formatting changes, moves and cell changes of a part, in document order, with their hidden item id and note.
 * The redactor calls this too, so both sides agree on the ids. (Insertions and deletions are handled apart.)
 */
export function docxChanges(document: Document): { element: Element; id: string; note: string; author: string }[] {
  const names = [...propertyChanges, "moveFrom", "moveTo", ...moveMarkers, "cellIns", "cellDel"];

  return elementsOf(document).flatMap((element) => {
    const id = attr(element, "w:id");
    const name = element.localName ?? "";

    if (id === null || !names.includes(name)) {
      return [];
    }

    const author = attr(element, "w:author") ?? "unknown author";
    const what = trackedNotes.get(name) ?? "Tracked formatting change";

    return [{ element, id: `${name}-${id}`, note: `${what} by ${author}`, author }];
  });
}

const linkFields = new Set(["HYPERLINK", "INCLUDETEXT", "INCLUDEPICTURE"]);

/** Switches that take the next token as their argument. */
const switchesWithArgument = new Set(["\\l", "\\o", "\\t", "\\c", "\\m"]);

/** The target of a HYPERLINK, INCLUDETEXT or INCLUDEPICTURE instruction; null for other fields and for in-document anchors. */
export function fieldTarget(instruction: string): string | null {
  const tokens = [...instruction.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => ({ text: match[1] ?? match[2], quoted: match[1] !== undefined }));

  if (!linkFields.has(tokens[0]?.text.toUpperCase() ?? "")) {
    return null;
  }

  for (let at = 1; at < tokens.length; at += 1) {
    const token = tokens[at];

    if (!token.quoted && token.text.startsWith("\\")) {
      at += switchesWithArgument.has(token.text.toLowerCase()) ? 1 : 0;
    } else {
      return token.text === "" ? null : token.text;
    }
  }

  return null;
}

export type DocxField = {
  /** The w:instrText nodes of a complex field, in order (empty for a simple one). */
  nodes: Element[];
  /** The w:fldSimple of a simple field. */
  simple: Element | null;
  instr: string;
  target: string | null;
  /** Hidden item id of a field that links out ("" otherwise). */
  id: string;
};

/** Fields of a part in document order of their first instruction: complex (fldChar) and simple (fldSimple). Shared with the redactor. */
export function docxFields(document: Document): DocxField[] {
  const fields: DocxField[] = [];
  const open: { nodes: Element[]; instructing: boolean }[] = [];

  const add = (nodes: Element[], simple: Element | null, instr: string) => {
    const target = fieldTarget(instr);

    fields.push({ nodes, simple, instr, target, id: target === null ? "" : `field-${shortHash(target)}` });
  };

  for (const element of elementsOf(document)) {
    const top = open.at(-1);

    if (element.nodeName === "w:fldSimple") {
      add([], element, attr(element, "w:instr") ?? "");
    } else if (element.nodeName === "w:instrText") {
      if (top?.instructing) {
        top.nodes.push(element);
      } else {
        add([element], null, element.textContent ?? "");
      }
    } else if (element.nodeName === "w:fldChar") {
      const type = attr(element, "w:fldCharType");

      if (type === "begin") {
        open.push({ nodes: [], instructing: true });
      } else if (type === "separate" && top) {
        top.instructing = false;
      } else if (type === "end") {
        const done = open.pop();

        if (done && done.nodes.length > 0) {
          add(done.nodes, null, done.nodes.map((node) => node.textContent).join(""));
        }
      }
    }
  }

  for (const rest of open.reverse()) {
    if (rest.nodes.length > 0) {
      add(rest.nodes, null, rest.nodes.map((node) => node.textContent).join(""));
    }
  }

  return fields;
}

/** The parts that hold text, in extraction order: body, headers, footers, notes, comments (not all need exist). */
export function docxParts(names: string[]): { part: string; title: string }[] {
  const byPrefix = (prefix: string) => names.filter((name) => new RegExp(`^word/${prefix}\\d*\\.xml$`).test(name));

  return [
    { part: "word/document.xml", title: "Body" },
    ...byPrefix("header").map((part, index) => ({ part, title: `Header ${index + 1}` })),
    ...byPrefix("footer").map((part, index) => ({ part, title: `Footer ${index + 1}` })),
    { part: "word/footnotes.xml", title: "Footnotes" },
    { part: "word/endnotes.xml", title: "Endnotes" },
    { part: "word/comments.xml", title: "Comments" },
  ];
}

export async function extractDocx(pkg: Pkg, builder: ModelBuilder): Promise<void> {
  await requiredXml(pkg, "word/document.xml");

  let tables = 0;

  for (const { part, title } of docxParts(pkg.names)) {
    const document = await pkg.xml(part);

    if (!document) {
      continue;
    }

    const piecesOf = pieceReader(document, docxTextNames, part, docxVisibleNames);
    const nodeIndex = new Map(textNodes(document, docxTextNames).map((node, at) => [node, at]));

    let flow: DocumentSection = builder.section(title, "flow");
    let paragraphs = 0;

    const emitTable = (table: Element) => {
      tables += 1;

      const grid = builder.section(`Table ${tables}`, "grid");
      const nested: Element[] = [];

      children(table, "tr").forEach((row, r) => {
        children(row, "tc").forEach((cell, c) => {
          const inside = blocks(cell);
          const pieces = inside.filter((block) => block.localName === "p").flatMap(piecesOf);

          builder.item(grid, `${grid.title} R${r + 1}C${c + 1}`, r, c, pieces, " ");
          nested.push(...inside.filter((block) => block.localName === "tbl"));
        });
      });
      nested.forEach(emitTable);
    };

    for (const block of blocks(document)) {
      if (block.localName === "p") {
        paragraphs += 1;
        builder.item(flow, `${title} paragraph ${paragraphs}`, null, null, piecesOf(block));
      } else {
        emitTable(block);
        flow = builder.section(title, "flow");
      }
    }

    // Field instructions: analysed as text, one item per field; links out are hidden items.
    const codes = builder.section(`Field codes: ${title}`, "flow");

    docxFields(document).forEach((field, at) => {
      const nodes = field.simple ? [field.simple] : field.nodes;
      const pieces = nodes.map((node) => ({ text: field.simple ? field.instr : (node.textContent ?? ""), part, node: nodeIndex.get(node) ?? -1 }));

      builder.item(codes, `${title} field ${at + 1}`, null, null, pieces);

      if (field.target !== null) {
        const host = hostOf(field.target);

        builder.hide({
          id: field.id,
          kind: "external-link",
          note: `Field link to ${host || field.target}`,
          quote: host || field.target,
          category: "hidden-data",
        });
      }
    });

    // Hidden content of this part.
    for (const run of descendants(document, "r")) {
      const found = hiddenRunOf(run);

      if (found) {
        const { kind, text } = found;
        const label = kind === "vanish" ? "Hidden text" : "Concealed text (white or tiny)";

        builder.hide({
          id: found.id,
          kind: "hidden-text",
          note: `${label}: '${text.slice(0, 60)}'`,
          quote: text,
          category: "hidden-data",
        });
      }
    }

    for (const change of [...descendants(document, "ins"), ...descendants(document, "del")]) {
      const id = attr(change, "w:id");
      const author = attr(change, "w:author") ?? "unknown author";
      const what = change.localName === "ins" ? "insertion" : "deletion";

      if (id !== null) {
        builder.hide({
          id: `${change.localName}-${id}`,
          kind: "revision",
          note: `Tracked ${what} by ${author}`,
          quote: author,
          category: "hidden-data",
        });
      }
    }

    for (const change of docxChanges(document)) {
      builder.hide({ id: change.id, kind: "revision", note: change.note, quote: change.author, category: "hidden-data" });
    }

    for (const comment of descendants(document, "comment")) {
      const id = attr(comment, "w:id");
      const author = attr(comment, "w:author") ?? "unknown author";

      const text = textNodes(comment, docxVisibleNames)
        .map((node) => node.textContent)
        .join(" ");

      if (id !== null) {
        builder.hide({
          id: `comment-${id}`,
          kind: "comment",
          note: `Comment by ${author}: '${text.slice(0, 60)}'`,
          quote: author,
          category: "hidden-data",
        });
      }
    }
  }
}
