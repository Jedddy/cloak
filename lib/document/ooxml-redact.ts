import type { Document, Element, Node } from "@xmldom/xmldom";
import JSZip from "jszip";

import type { DocumentRedactionInput, DocumentRedactionResult } from "@/lib/contract/interfaces";
import { redactImage } from "@/lib/redact/image";

import {
  attr,
  children,
  descendants,
  isElement,
  loadPackage,
  parseXml,
  relationships,
  serializeXml,
  shortHash,
  textNodes,
  type Relationship,
} from "./ooxml";

// OOXML redaction (plan U6). Inverts the extractors: segments and hidden item
// ids are resolved to the same XML nodes, edited in place, and a new zip is
// built from the parts still reachable from the package root (KTD4).

const PLACEHOLDER = "[REDACTED]";

const REMOVED = "[Object removed]";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const objectDirs = ["/charts/", "/diagrams/", "/embeddings/"];

const falsy = new Set(["0", "false", "off"]);

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** All elements under `root` (excluding it), in document order. */
function elementsUnder(root: Node): Element[] {
  const out: Element[] = [];

  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (isElement(child)) {
        out.push(child);
        visit(child);
      }
    }
  };

  visit(root);

  return out;
}

function drop(element: Node): void {
  element.parentNode?.removeChild(element);
}

function unwrap(element: Element): void {
  const parent = element.parentNode;

  for (const child of Array.from(element.childNodes)) {
    parent?.insertBefore(child, element);
  }

  drop(element);
}

function setText(element: Element, text: string): void {
  element.textContent = text;
}

/** An element parsed from `xml` (which declares its own namespaces), owned by `document`. */
function fragment(document: Document, xml: string): Element {
  // SAFETY: parseXml returns a document with a root element, and importNode of an element yields an element.
  return document.importNode(parseXml(xml).documentElement as Element, true) as Element;
}

function attached(element: Node): boolean {
  let node: Node | null = element;

  while (node.parentNode) {
    node = node.parentNode;
  }

  return node.nodeType === 9;
}

/** Values of every `r:*` attribute under (and including) `root`. */
function relationshipIds(root: Node): Set<string> {
  const ids = new Set<string>();

  for (const element of isElement(root) ? [root, ...elementsUnder(root)] : elementsUnder(root)) {
    for (const index of Array.from({ length: element.attributes.length }, (_, at) => at)) {
      const attribute = element.attributes.item(index);

      if (attribute?.name.startsWith("r:")) {
        ids.add(attribute.value);
      }
    }
  }

  return ids;
}

const relsPathOf = (part: string) => `${part.slice(0, part.lastIndexOf("/") + 1)}_rels/${part.slice(part.lastIndexOf("/") + 1)}.rels`;

/** The part a `.rels` file describes; "" for the package-level one. */
function ownerOf(relsPart: string): string {
  const match = /^(.*)_rels\/(.*)\.rels$/.exec(relsPart);

  return match ? `${match[1]}${match[2]}` : "";
}

const lastSegment = (type: string) => type.slice(type.lastIndexOf("/") + 1);

const collapse = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

// ---------------------------------------------------------------------------
// DOCX / XLSX details copied from the extractors, so ids match exactly
// ---------------------------------------------------------------------------

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

function columnNumber(letters: string): number {
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

/** Whether a formula or defined name mentions a sheet by name. */
function mentionsSheet(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return text.includes(`'${name.replace(/'/g, "''")}'!`) || new RegExp(`(?<![\\w.'])${escaped}!`).test(text);
}

const cellReference =
  /(?<![\w.'!\]])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(!])/g;

/** Whether `formula`, written in sheet `home`, reads cell `ref` of sheet `sheet`. */
function formulaReads(formula: string, home: string, sheet: string, ref: string): boolean {
  const plain = formula
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/(?:'[^']*\[\d+\][^']*'|\[\d+\][\w. ]*)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, "");

  const target = /^([A-Z]+)(\d+)$/.exec(ref);

  if (!target) {
    return false;
  }

  const col = columnNumber(target[1]);
  const row = Number(target[2]);

  return [...plain.matchAll(cellReference)].some((match) => {
    const named = match[1]?.replace(/''/g, "'") ?? match[2] ?? home;

    if (named.toLowerCase() !== sheet.toLowerCase()) {
      return false;
    }

    const firstCol = columnNumber(match[3]);
    const firstRow = Number(match[4]);
    const lastCol = match[5] ? columnNumber(match[5]) : firstCol;
    const lastRow = match[6] ? Number(match[6]) : firstRow;

    return col >= Math.min(firstCol, lastCol) && col <= Math.max(firstCol, lastCol) && row >= Math.min(firstRow, lastRow) && row <= Math.max(firstRow, lastRow);
  });
}

function textNamesFor(format: DocumentRedactionInput["format"], part: string): string[] {
  if (format === "docx") {
    return ["w:t", "w:delText"];
  }

  if (format === "pptx") {
    return part.startsWith("ppt/comments/") && !part.includes("modernComment") ? ["p:text"] : ["a:t"];
  }

  return part.includes("threadedComment") ? ["text"] : ["t"];
}

const entities: [RegExp, string][] = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&amp;/g, "&"],
];

/** Searchable text variants of a part: XML tag-stripped (joined and spaced), or raw bytes for binary. */
async function searchable(part: string, bytes: Uint8Array): Promise<string[]> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const nested = await JSZip.loadAsync(bytes);
      const out: string[] = [];

      for (const name of Object.keys(nested.files).filter((entry) => !nested.files[entry].dir)) {
        out.push(...(await searchable(name, await nested.files[name].async("uint8array"))));
      }

      return out;
    } catch {
      return [];
    }
  }

  if (/\.(xml|rels|vml)$/.test(part)) {
    const xml = entities.reduce((text, [pattern, value]) => text.replace(pattern, value), new TextDecoder().decode(bytes));

    return [xml.replace(/<[^>]*>/g, ""), xml.replace(/<[^>]*>/g, " ")];
  }

  return [Buffer.from(bytes).toString("latin1"), Buffer.from(bytes).toString("utf16le")];
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

type Edit = { part: string; node: Element; from: number; to: number; placeholder: boolean };

export async function redactOoxml(input: DocumentRedactionInput): Promise<DocumentRedactionResult> {
  const { model, format } = input;
  const pkg = await loadPackage(input.bytes);
  const { zip } = pkg;
  const touched = new Set<string>();
  const notes: DocumentRedactionResult["notes"] = [];
  const hidden = new Set(input.removeHidden);

  const names = () => Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  /** A parsed part that the caller is about to change. */
  const edit = async (part: string) => {
    const document = await pkg.xml(part);

    if (document) {
      touched.add(part);
    }

    return document;
  };

  /** Removes matching relationships of `owner`, returning them. */
  const removeRels = async (owner: string, match: (rel: Relationship) => boolean): Promise<Relationship[]> => {
    const gone = (await relationships(pkg, owner)).filter(match);

    if (gone.length === 0) {
      return [];
    }

    const document = await edit(relsPathOf(owner));

    for (const element of document ? descendants(document, "Relationship") : []) {
      if (gone.some((rel) => rel.id === element.getAttribute("Id"))) {
        drop(element);
      }
    }

    return gone;
  };

  /** Drops formulas (keeping cached values) whose text matches, with the followers of shared formulas. */
  const dropFormulas = (document: Document, matches: (formula: string) => boolean) => {
    const formulas = descendants(document, "f");
    const shared = new Set<string>();

    for (const formula of formulas) {
      if (matches(formula.textContent ?? "")) {
        shared.add(attr(formula, "t") === "shared" ? (attr(formula, "si") ?? "") : "");
        drop(formula);
      }
    }

    for (const formula of formulas) {
      if (attr(formula, "t") === "shared" && shared.has(attr(formula, "si") ?? "") && formula.parentNode) {
        drop(formula);
      }
    }
  };

  // Spans, merged where they overlap.
  const spans = [...input.spans]
    .sort((a, b) => a.start - b.start)
    .reduce<{ start: number; end: number }[]>((merged, span) => {
      const last = merged.at(-1);

      if (last && span.start < last.end) {
        last.end = Math.max(last.end, span.end);
      } else {
        merged.push({ ...span });
      }

      return merged;
    }, []);

  const workbook = format === "xlsx" ? await pkg.xml("xl/workbook.xml") : null;
  const workbookRels = format === "xlsx" ? await relationships(pkg, "xl/workbook.xml") : [];

  const sheets = (workbook ? descendants(workbook, "sheet") : []).map((element, index) => ({
    element,
    index,
    name: attr(element, "name") ?? "Sheet",
    rid: attr(element, "r:id") ?? "",
    part: workbookRels.find((rel) => rel.id === attr(element, "r:id"))?.target ?? "",
  }));

  const deadSheets = new Set<string>();

  // A. Resolve text spans to nodes before any structure changes, so node indexes still line up.
  const edits: Edit[] = [];
  const redactedCells = new Map<string, Set<string>>();
  const nodeCache = new Map<string, Element[]>();

  const nodesOf = async (part: string) => {
    const cached = nodeCache.get(part);

    if (cached) {
      return cached;
    }

    const document = await pkg.xml(part);
    const nodes = document ? textNodes(document, textNamesFor(format, part)) : [];

    nodeCache.set(part, nodes);

    return nodes;
  };

  for (const span of spans) {
    let first = true;

    for (const segment of model.segments) {
      if (segment.start >= span.end || segment.end <= span.start) {
        continue;
      }

      if (segment.node === -1) {
        const cells = redactedCells.get(segment.part) ?? new Set<string>();

        cells.add(segment.cell ?? "");
        redactedCells.set(segment.part, cells);
      } else {
        const node = (await nodesOf(segment.part))[segment.node];

        if (node) {
          const from = Math.max(span.start, segment.start) - segment.start;
          const to = Math.min(span.end, segment.end) - segment.start;

          edits.push({ part: segment.part, node, from, to, placeholder: first });
        }
      }

      first = false;
    }
  }

  // B. Hidden items.
  if (format === "docx") {
    const parts = names().filter((name) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name));
    const goneComments = new Set<string>();

    for (const part of parts) {
      const document = await pkg.xml(part);

      if (!document) {
        continue;
      }

      for (const run of descendants(document, "r")) {
        const kind = hiddenRunKind(run);
        const text = textNodes(run, ["w:t", "w:delText"]).map((node) => node.textContent).join("");

        if (kind && text !== "" && hidden.has(`${kind}-${shortHash(text)}`)) {
          drop(run);
          touched.add(part);
        }
      }

      for (const change of [...descendants(document, "ins"), ...descendants(document, "del")]) {
        const id = attr(change, "w:id");

        if (id === null || !hidden.has(`${change.localName}-${id}`) || !change.parentNode) {
          continue;
        }

        // Accepted insertions keep their content; paragraph-mark markers (inside rPr/trPr) are just removed.
        if (change.localName === "ins" && !/Pr$/.test(change.parentNode.localName ?? "")) {
          unwrap(change);
        } else {
          drop(change);
        }

        touched.add(part);
      }

      for (const comment of descendants(document, "comment")) {
        const id = attr(comment, "w:id");

        if (id !== null && hidden.has(`comment-${id}`)) {
          goneComments.add(id);
          drop(comment);
          touched.add(part);
        }
      }
    }

    if (goneComments.size > 0) {
      for (const part of parts) {
        const document = await pkg.xml(part);

        for (const marker of document ? elementsUnder(document) : []) {
          const id = attr(marker, "w:id");

          if (id === null || !goneComments.has(id) || !marker.parentNode) {
            continue;
          }

          if (marker.localName === "commentRangeStart" || marker.localName === "commentRangeEnd") {
            drop(marker);
          } else if (marker.localName === "commentReference") {
            drop(marker.parentNode.localName === "r" ? marker.parentNode : marker);
          } else {
            continue;
          }

          touched.add(part);
        }
      }

      const comments = await pkg.xml("word/comments.xml");
      const remaining = comments ? descendants(comments, "comment") : [];
      const commentTypes = new Set(["comments", "commentsExtended", "commentsIds", "commentsExtensible", "people"]);

      if (remaining.length === 0) {
        await removeRels("word/document.xml", (rel) => commentTypes.has(lastSegment(rel.type)));
      } else {
        // people.xml lists comment authors: keep only those who still have a comment.
        const authors = new Set(remaining.map((comment) => attr(comment, "w:author")));
        const people = await edit("word/people.xml");

        for (const person of people ? descendants(people, "person") : []) {
          if (!authors.has(attr(person, "w15:author"))) {
            drop(person);
          }
        }
      }
    }
  }

  // External links, in every format: drop the relationship and the elements that use it.
  for (const relsPart of names().filter((name) => name.endsWith(".rels") && !name.startsWith("xl/externalLinks/"))) {
    const owner = ownerOf(relsPart);
    const gone = await removeRels(owner, (rel) => rel.external && hidden.has(`link-${shortHash(rel.target)}`));
    const document = gone.length > 0 && owner !== "" ? await edit(owner) : null;

    for (const element of document ? elementsUnder(document) : []) {
      if (element.parentNode && gone.some((rel) => rel.id === attr(element, "r:id"))) {
        // A Word hyperlink keeps its text; everything else that points at the link goes.
        if (element.nodeName === "w:hyperlink") {
          unwrap(element);
        } else {
          drop(element);
        }
      }
    }
  }

  if (format === "xlsx" && workbook) {
    // Hidden sheets.
    const removed = sheets.filter((sheet) => hidden.has(`sheet-${sheet.name}`));

    for (const sheet of removed) {
      drop(sheet.element);
      deadSheets.add(sheet.part);
      await removeRels("xl/workbook.xml", (rel) => rel.id === sheet.rid);
    }

    // External workbooks, 1-based in workbook.xml order.
    const links: { element: Element; rid: string; id: string }[] = [];

    for (const element of descendants(workbook, "externalReference")) {
      const rid = attr(element, "r:id") ?? "";
      const part = workbookRels.find((rel) => rel.id === rid)?.target ?? "";
      const external = (await relationships(pkg, part)).find((rel) => rel.external);

      links.push({ element, rid, id: `extlink-${shortHash(external?.target ?? part)}` });
    }

    const goneLinks = links.flatMap((link, at) => (hidden.has(link.id) ? [at + 1] : []));
    const shift = (n: number) => n - goneLinks.filter((gone) => gone < n).length;
    const mentionsGone = (text: string) => [...text.matchAll(/\[(\d+)\]/g)].some((match) => goneLinks.includes(Number(match[1])));
    const renumber = (text: string) => text.replace(/\[(\d+)\]/g, (_, n: string) => `[${shift(Number(n))}]`);

    for (const link of links.filter((entry) => hidden.has(entry.id))) {
      drop(link.element);
      await removeRels("xl/workbook.xml", (rel) => rel.id === link.rid);
    }

    touched.add("xl/workbook.xml");

    for (const name of descendants(workbook, "definedName")) {
      const text = name.textContent ?? "";
      const local = attr(name, "localSheetId");

      if (mentionsGone(text) || removed.some((sheet) => mentionsSheet(text, sheet.name) || String(sheet.index) === local)) {
        drop(name);
      } else {
        if (local !== null) {
          name.setAttribute("localSheetId", String(Number(local) - removed.filter((sheet) => sheet.index < Number(local)).length));
        }

        if (goneLinks.length > 0) {
          setText(name, renumber(text));
        }
      }
    }

    for (const sheet of sheets.filter((entry) => !deadSheets.has(entry.part))) {
      const document = await pkg.xml(sheet.part);

      if (!document) {
        continue;
      }

      touched.add(sheet.part);
      dropFormulas(document, (formula) => mentionsGone(formula) || removed.some((entry) => mentionsSheet(formula, entry.name)));

      if (goneLinks.length > 0) {
        for (const formula of descendants(document, "f")) {
          setText(formula, renumber(formula.textContent ?? ""));
        }
      }

      // Hidden rows and columns: clear their cells.
      const rowsHidden = hidden.has(`rows-${sheet.name}`);
      const colsHidden = hidden.has(`cols-${sheet.name}`);

      const columns = descendants(document, "col")
        .filter((col) => ["1", "true"].includes(attr(col, "hidden") ?? ""))
        .map((col) => [Number(attr(col, "min")), Number(attr(col, "max"))]);

      for (const row of descendants(document, "row")) {
        const rowIsHidden = ["1", "true"].includes(attr(row, "hidden") ?? "");

        for (const cell of children(row, "c")) {
          const column = columnNumber(/^[A-Z]+/.exec(attr(cell, "r") ?? "")?.[0] ?? "");

          if ((rowsHidden && rowIsHidden) || (colsHidden && columns.some(([min, max]) => column >= min && column <= max))) {
            drop(cell);
          }
        }
      }

      // Comments: legacy and threaded, with the drawing that shows the legacy ones.
      const goneComments = await removeRels(sheet.part, (rel) => {
        const type = lastSegment(rel.type);

        return (type === "comments" || type === "threadedComment") && hidden.has(`comments-${rel.target}`);
      });

      if (goneComments.some((rel) => lastSegment(rel.type) === "comments")) {
        await removeRels(sheet.part, (rel) => lastSegment(rel.type) === "vmlDrawing");

        for (const legacy of descendants(document, "legacyDrawing")) {
          drop(legacy);
        }
      }
    }
  }

  if (format === "pptx") {
    const presentation = await edit("ppt/presentation.xml");
    const slideIds = new Set<string>();
    const slideRids = new Set<string>();

    for (const slide of presentation ? descendants(presentation, "sldId") : []) {
      const id = attr(slide, "id") ?? "";

      if (hidden.has(`slide-${id}`)) {
        slideIds.add(id);
        slideRids.add(attr(slide, "r:id") ?? "");
        drop(slide);
      }
    }

    await removeRels("ppt/presentation.xml", (rel) => slideRids.has(rel.id));

    for (const relsPart of names().filter((name) => /^ppt\/slides\/_rels\//.test(name))) {
      await removeRels(ownerOf(relsPart), (rel) => !rel.external && hidden.has(`comments-${rel.target}`));
    }
  }

  // C. Apply the text edits: the first node of each span gets the placeholder, the others lose their overlapped text.
  const byNode = new Map<Element, Edit[]>();

  for (const entry of edits) {
    byNode.set(entry.node, [...(byNode.get(entry.node) ?? []), entry]);
  }

  for (const [node, list] of byNode) {
    let text = node.textContent ?? "";

    for (const entry of list.sort((a, b) => b.from - a.from)) {
      text = text.slice(0, entry.from) + (entry.placeholder ? PLACEHOLDER : "") + text.slice(entry.to);
    }

    setText(node, text);
    touched.add(list[0].part);

    if (node.nodeName.startsWith("w:")) {
      node.setAttribute("xml:space", "preserve");
    }
  }

  // XLSX cells: inline [REDACTED]; dependents are flagged, not rewritten.
  if (format === "xlsx") {
    const nameOf = new Map(sheets.map((sheet) => [sheet.part, sheet.name]));
    const redacted = new Set([...redactedCells].flatMap(([part, refs]) => [...refs].map((ref) => `${nameOf.get(part)}!${ref}`)));
    const flagged = new Set<string>();

    for (const sheet of sheets.filter((entry) => !deadSheets.has(entry.part))) {
      const document = await pkg.xml(sheet.part);

      for (const cell of document ? descendants(document, "c") : []) {
        const ref = attr(cell, "r") ?? "";
        const formula = children(cell, "f")[0]?.textContent ?? "";

        if (formula === "" || redacted.has(`${sheet.name}!${ref}`)) {
          continue;
        }

        for (const target of redacted) {
          const at = target.lastIndexOf("!");
          const note = `${input.fileName}: ${sheet.name}!${ref} uses redacted cell ${target}; its formula was not rewritten.`;

          if (!flagged.has(note) && formulaReads(formula, sheet.name, target.slice(0, at), target.slice(at + 1))) {
            flagged.add(note);
            notes.push({ kind: "formula-dependency", note });
          }
        }
      }
    }

    for (const [part, refs] of redactedCells) {
      const document = await edit(part);

      for (const cell of document ? descendants(document, "c") : []) {
        if (!refs.has(attr(cell, "r") ?? "")) {
          continue;
        }

        const create = (name: string) => document!.createElementNS(cell.namespaceURI, cell.prefix ? `${cell.prefix}:${name}` : name);
        const inline = create("is");
        const text = create("t");

        for (const child of Array.from(cell.childNodes)) {
          drop(child);
        }

        setText(text, PLACEHOLDER);
        inline.appendChild(text);
        cell.setAttribute("t", "inlineStr");
        cell.appendChild(inline);
      }
    }
  }

  // Always (R17): identity metadata, custom data, and the calc chain.
  for (const name of names()) {
    if (/^docProps\/(core|app|custom)\.xml$/.test(name) || /^docProps\/thumbnail\./.test(name) || name.startsWith("customXml/") || name === "xl/calcChain.xml") {
      zip.remove(name);
    }
  }

  /**
   * Drops relationships to missing parts, then every part not reachable from the package root,
   * so nothing orphaned (a deleted slide's notes, a comment drawing) stays in the archive.
   */
  const sweep = async () => {
    for (const relsPart of names().filter((name) => name.endsWith(".rels"))) {
      await removeRels(ownerOf(relsPart), (rel) => !rel.external && !zip.file(rel.target));
    }

    const keep = new Set(["[Content_Types].xml"]);
    const queue = [""];

    for (let owner = queue.pop(); owner !== undefined; owner = queue.pop()) {
      if (zip.file(relsPathOf(owner))) {
        keep.add(relsPathOf(owner));
      }

      for (const rel of await relationships(pkg, owner)) {
        if (!rel.external && zip.file(rel.target) && !keep.has(rel.target)) {
          keep.add(rel.target);
          queue.push(rel.target);
        }
      }
    }

    for (const name of names()) {
      if (!keep.has(name)) {
        zip.remove(name);
      }
    }
  };

  await sweep();

  // Authors and persons that no comment part uses any more.
  if (format === "pptx" && !names().some((name) => /^ppt\/comments\/[^/]+\.xml$/.test(name))) {
    await removeRels("ppt/presentation.xml", (rel) => ["commentAuthors", "authors"].includes(lastSegment(rel.type)));
  }

  if (format === "xlsx") {
    const threaded = await Promise.all(names().filter((name) => name.startsWith("xl/worksheets/")).map((name) => relationships(pkg, name)));

    if (!threaded.flat().some((rel) => lastSegment(rel.type) === "threadedComment")) {
      await removeRels("xl/workbook.xml", (rel) => lastSegment(rel.type) === "person");
    }
  }

  await sweep();

  // R18: charts, SmartArt and embedded objects that contain redacted text are replaced, not rewritten.
  const quotes = [...new Set(spans.map((span) => collapse(model.text.slice(span.start, span.end))).filter((quote) => quote.length >= 3))];

  const objectLabel = (target: string): string | null => {
    if (/\/charts\/chart[^/]*\.xml$/.test(target)) {
      return `Chart ${target}`;
    }

    if (/\/diagrams\/data[^/]*\.xml$/.test(target)) {
      return `SmartArt ${target}`;
    }

    return target.includes("/embeddings/") ? `Embedded object ${target}` : null;
  };

  const owners = quotes.length === 0 ? [] : names().filter((name) => /\.xml$/.test(name) && !objectDirs.some((dir) => name.includes(dir)) && zip.file(relsPathOf(name)));

  for (const owner of owners) {
    const rels = await relationships(pkg, owner);
    const objectRels = rels.filter((rel) => !rel.external && objectDirs.some((dir) => `/${rel.target}`.includes(dir)));

    if (objectRels.length === 0) {
      continue;
    }

    const document = await pkg.xml(owner);
    const frames = (document ? elementsUnder(document) : []).filter((element) => ["drawing", "object", "graphicFrame"].includes(element.localName ?? ""));

    for (const frame of frames) {
      const used = relationshipIds(frame);
      const mine = objectRels.filter((rel) => used.has(rel.id));

      if (!document || !attached(frame) || mine.length === 0) {
        continue;
      }

      // The object is its parts plus everything they link to (embedded workbook, styles).
      const closure = new Set<string>();
      const queue = mine.map((rel) => rel.target);

      for (let part = queue.pop(); part !== undefined; part = queue.pop()) {
        if (closure.has(part) || !zip.file(part)) {
          continue;
        }

        closure.add(part);
        queue.push(...(await relationships(pkg, part)).filter((rel) => !rel.external).map((rel) => rel.target));
      }

      const texts: string[] = [];

      for (const part of closure) {
        texts.push(...(await searchable(part, await zip.file(part)!.async("uint8array"))));
      }

      const found = texts.map(collapse);

      if (!quotes.some((quote) => found.some((text) => text.includes(quote)))) {
        continue;
      }

      // SmartArt points at its rendered drawing through an attribute of the data part.
      const extra = new Set<string>();

      for (const part of closure) {
        const data = part.includes("/diagrams/data") ? await pkg.xml(part) : null;

        for (const ext of data ? descendants(data, "dataModelExt") : []) {
          extra.add(attr(ext, "relId") ?? "");
        }
      }

      const label = mine.map((rel) => objectLabel(rel.target)).find((entry) => entry !== null) ?? `Object ${mine[0].target}`;
      const id = descendants(frame, "cNvPr")[0]?.getAttribute("id") ?? "1";
      const xfrm = children(frame, "xfrm")[0];
      const off = xfrm ? descendants(xfrm, "off")[0] : undefined;
      const ext = xfrm ? descendants(xfrm, "ext")[0] : undefined;

      const position = `<a:xfrm><a:off x="${off ? attr(off, "x") : 0}" y="${off ? attr(off, "y") : 0}"/><a:ext cx="${ext ? attr(ext, "cx") : 0}" cy="${ext ? attr(ext, "cy") : 0}"/></a:xfrm>`;
      const body = `<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${REMOVED}</a:t></a:r></a:p>`;
      const geometry = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

      if (format === "docx") {
        // Replace the drawing (or object) in its run with plain text.
        let target: Node = frame;

        while (target.parentNode && target.parentNode.nodeName !== "w:r") {
          target = target.parentNode;
        }

        const text = fragment(document, `<w:t xmlns:w="${NS_W}" xml:space="preserve">${REMOVED}</w:t>`);

        target.parentNode?.replaceChild(text, target);
      } else if (format === "pptx") {
        const frameXml =
          `<p:sp xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:nvSpPr><p:cNvPr id="${id}" name="Object removed"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
          `<p:spPr>${position}${geometry}</p:spPr><p:txBody>${body}</p:txBody></p:sp>`;

        frame.parentNode?.replaceChild(fragment(document, frameXml), frame);
      } else {
        const frameXml =
          `<xdr:sp xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="Object removed"/>` +
          `<xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr>${position}${geometry}</xdr:spPr><xdr:txBody>${body}</xdr:txBody></xdr:sp>`;

        frame.parentNode?.replaceChild(fragment(document, frameXml), frame);
      }

      // Drop the relationships the frame used, unless something else in the owner still points at them.
      const stillUsed = relationshipIds(document);

      await removeRels(owner, (rel) => (used.has(rel.id) || extra.has(rel.id)) && !stillUsed.has(rel.id));
      touched.add(owner);
      notes.push({ kind: "object-removed", note: `${input.fileName}: ${label} removed: it contained redacted text.` });
    }
  }

  await sweep();

  // Embedded images: OCR words under a span, and approved regions.
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }[]>();

  const addBox = (anchor: string, box: { x: number; y: number; w: number; h: number }) => {
    if (anchor.startsWith("image:")) {
      boxes.set(anchor.slice("image:".length), [...(boxes.get(anchor.slice("image:".length)) ?? []), box]);
    }
  };

  for (const word of model.words) {
    if (spans.some((span) => word.start < span.end && word.end > span.start)) {
      addBox(word.anchor, word.box);
    }
  }

  for (const region of input.regions) {
    addBox(region.anchor, region.box);
  }

  for (const [id, list] of boxes) {
    const file = zip.file(id);
    const mime = model.images.find((image) => image.id === id)?.mime;

    if (file && mime) {
      zip.file(id, await redactImage({ bytes: await file.async("uint8array"), mime, boxes: list }));
    }
  }

  // XLSX: keep only shared strings some cell still uses, and renumber.
  const stringsPart = "xl/sharedStrings.xml";

  if (format === "xlsx" && zip.file(stringsPart)) {
    const strings = await edit(stringsPart);
    const root = strings?.documentElement;
    const items = root ? children(root, "si") : [];
    const refs: Element[] = [];

    for (const name of names().filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry))) {
      const document = await edit(name);

      for (const cell of document ? descendants(document, "c") : []) {
        if (attr(cell, "t") === "s" && children(cell, "v")[0]) {
          refs.push(children(cell, "v")[0]);
        }
      }
    }

    const used = [...new Set(refs.map((value) => Number(value.textContent)))].sort((a, b) => a - b);
    const renumbered = new Map(used.map((old, at) => [old, at]));

    items.forEach((item, at) => {
      if (!renumbered.has(at)) {
        drop(item);
      }
    });

    for (const value of refs) {
      setText(value, String(renumbered.get(Number(value.textContent)) ?? 0));
    }

    root?.setAttribute("count", String(refs.length));
    root?.setAttribute("uniqueCount", String(used.length));
  }

  // Content types of parts that are gone.
  const types = await edit("[Content_Types].xml");

  for (const override of types ? descendants(types, "Override") : []) {
    if (!zip.file((override.getAttribute("PartName") ?? "").replace(/^\//, ""))) {
      drop(override);
    }
  }

  for (const part of touched) {
    const document = await pkg.xml(part);

    if (document && zip.file(part)) {
      zip.file(part, serializeXml(document));
    }
  }

  // A new archive from the kept parts only (KTD4).
  const out = new JSZip();

  for (const name of ["[Content_Types].xml", ...names().filter((entry) => entry !== "[Content_Types].xml")]) {
    out.file(name, await zip.file(name)!.async("uint8array"));
  }

  return { bytes: await out.generateAsync({ type: "uint8array", compression: "DEFLATE" }), notes };
}
