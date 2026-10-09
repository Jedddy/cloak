import type { Element, Node } from "@xmldom/xmldom";

import type { DocumentSection } from "@/lib/contract/schemas";

import { attr, children, descendants, pieceReader, requiredXml, textNodes, type ModelBuilder, type Pkg } from "./ooxml";
import { shortHash } from "./shared";

// DOCX extraction Text nodes are w:t and w:delText; a segment's
// `node` is the node's index in textNodes(part, docxTextNames).

export const docxTextNames = ["w:t", "w:delText"];

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

  const text = textNodes(run, docxTextNames)
    .map((node) => node.textContent)
    .join("");

  return kind && text !== "" ? { kind, text, id: `${kind}-${shortHash(text)}` } : null;
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

    const piecesOf = pieceReader(document, docxTextNames, part);

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

    for (const comment of descendants(document, "comment")) {
      const id = attr(comment, "w:id");
      const author = attr(comment, "w:author") ?? "unknown author";

      const text = textNodes(comment, docxTextNames)
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
