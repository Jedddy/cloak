import type { Document, Element, Node } from "@xmldom/xmldom";
import JSZip from "jszip";

import type { DocumentRedactionInput, DocumentRedactionResult } from "@/lib/contract/interfaces";
import { RESIDUE_MIN_NEEDLE, imageAnchor } from "@/lib/contract/schemas";
import type { Box } from "@/lib/contract/schemas";
import { redactImage } from "@/lib/redact/image";
import { columnNumber, normalizeText } from "@/lib/utils";

import { docxParts, docxTextNames, hiddenRunOf } from "./docx";
import {
  attr,
  children,
  descendants,
  elementsOf,
  loadPackage,
  objectKind,
  ownerOf,
  parseXml,
  relationships,
  relsPathOf,
  serializeXml,
  textNodes,
  type Pkg,
  type Relationship,
} from "./ooxml";
import { pptxCommentNames, pptxTextNames } from "./pptx";
import { appendTo, shortHash } from "./shared";
import { truthy, xlsxCommentNames } from "./xlsx";

// OOXML redaction. Inverts the extractors: segments and hidden item
// ids are resolved to the same XML nodes, edited in place, and a new zip is
// built from the parts still reachable from the package root (KTD4).

const PLACEHOLDER = "[REDACTED]";

const REMOVED = "[Object removed]";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const objectDirs = ["/charts/", "/diagrams/", "/embeddings/"];

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

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
function relationshipIds(root: Document | Element): Set<string> {
  const ids = new Set<string>();

  for (const element of elementsOf(root)) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("r:")) {
        ids.add(attribute.value);
      }
    }
  }

  return ids;
}

const lastSegment = (type: string) => type.slice(type.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------------
// XLSX formula details
// ---------------------------------------------------------------------------

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

/** Drops formulas (keeping cached values) whose text matches, with the followers of shared formulas. */
function dropFormulas(document: Document, matches: (formula: string) => boolean): void {
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
}

function textNamesFor(format: DocumentRedactionInput["format"], part: string): string[] {
  if (format === "docx") {
    return docxTextNames;
  }

  if (format === "pptx") {
    return part.startsWith("ppt/comments/") ? pptxCommentNames(part) : pptxTextNames;
  }

  return xlsxCommentNames(part.includes("threadedComment"));
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

type Sheet = { element: Element; index: number; name: string; rid: string; part: string };

/** State shared by the redaction phases. */
type Context = {
  input: DocumentRedactionInput;
  pkg: Pkg;
  zip: JSZip;
  /** Parts whose parsed XML is written back at the end. */
  touched: Set<string>;
  notes: DocumentRedactionResult["notes"];
  /** Ids of the hidden items to remove. */
  hidden: Set<string>;
  /** Spans, merged where they overlap. */
  spans: { start: number; end: number }[];
  workbookRels: Relationship[];
  sheets: Sheet[];
  /** Parts of removed sheets. */
  deadSheets: Set<string>;
  /** Cell references to blank, by sheet part. */
  redactedCells: Map<string, Set<string>>;
};

const zipNames = (context: Context) => Object.keys(context.zip.files).filter((name) => !context.zip.files[name].dir);

/** A parsed part that the caller is about to change. */
async function editPart(context: Context, part: string): Promise<Document | null> {
  const document = await context.pkg.xml(part);

  if (document) {
    context.touched.add(part);
  }

  return document;
}

/** Removes matching relationships of `owner`, returning them. */
async function removeRels(context: Context, owner: string, match: (rel: Relationship) => boolean): Promise<Relationship[]> {
  const gone = (await relationships(context.pkg, owner)).filter(match);

  if (gone.length === 0) {
    return [];
  }

  const document = await editPart(context, relsPathOf(owner));

  for (const element of document ? descendants(document, "Relationship") : []) {
    if (gone.some((rel) => rel.id === element.getAttribute("Id"))) {
      drop(element);
    }
  }

  return gone;
}

/**
 * Drops relationships to missing parts, then every part not reachable from the package root,
 * so nothing orphaned (a deleted slide's notes, a comment drawing) stays in the archive.
 */
async function sweep(context: Context): Promise<void> {
  const { zip, pkg } = context;

  for (const relsPart of zipNames(context).filter((name) => name.endsWith(".rels"))) {
    await removeRels(context, ownerOf(relsPart), (rel) => !rel.external && !zip.file(rel.target));
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

  for (const name of zipNames(context)) {
    if (!keep.has(name)) {
      zip.remove(name);
    }
  }
}

/** Resolves text spans to nodes before any structure changes, so node indexes still line up. */
async function resolveSpans(context: Context): Promise<Edit[]> {
  const { pkg, spans, redactedCells } = context;
  const { model, format } = context.input;
  const edits: Edit[] = [];
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
      // Segments are in text order, so none after this one overlaps the span.
      if (segment.start >= span.end) {
        break;
      }

      if (segment.end <= span.start) {
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

  return edits;
}

/** Hidden runs, tracked changes and comments of a DOCX, with the markers that point at removed comments. */
async function removeDocxHidden(context: Context): Promise<void> {
  const { pkg, hidden, touched } = context;
  const parts = docxParts(pkg.names).map((entry) => entry.part);
  const goneComments = new Set<string>();

  for (const part of parts) {
    const document = await pkg.xml(part);

    if (!document) {
      continue;
    }

    for (const run of descendants(document, "r")) {
      const found = hiddenRunOf(run);

      if (found && hidden.has(found.id)) {
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

  if (goneComments.size === 0) {
    return;
  }

  for (const part of parts) {
    const document = await pkg.xml(part);

    for (const marker of document ? elementsOf(document) : []) {
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
    await removeRels(context, "word/document.xml", (rel) => commentTypes.has(lastSegment(rel.type)));
  } else {
    // people.xml lists comment authors: keep only those who still have a comment.
    const authors = new Set(remaining.map((comment) => attr(comment, "w:author")));
    const people = await editPart(context, "word/people.xml");

    for (const person of people ? descendants(people, "person") : []) {
      if (!authors.has(attr(person, "w15:author"))) {
        drop(person);
      }
    }
  }
}

/** External links, in every format: drops the relationship and the elements that use it. */
async function removeExternalLinks(context: Context): Promise<void> {
  const { hidden } = context;

  for (const relsPart of zipNames(context).filter((name) => name.endsWith(".rels") && !name.startsWith("xl/externalLinks/"))) {
    const owner = ownerOf(relsPart);
    const gone = await removeRels(context, owner, (rel) => rel.external && hidden.has(`link-${shortHash(rel.target)}`));
    const document = gone.length > 0 && owner !== "" ? await editPart(context, owner) : null;

    for (const element of document ? elementsOf(document) : []) {
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
}

/** Hidden sheets, external workbooks, hidden rows and columns, and comments of an XLSX. */
async function removeXlsxHidden(context: Context, workbook: Document): Promise<void> {
  const { pkg, hidden, touched, sheets, deadSheets, workbookRels } = context;

  // Hidden sheets.
  const removed = sheets.filter((sheet) => hidden.has(`sheet-${sheet.name}`));

  for (const sheet of removed) {
    drop(sheet.element);
    deadSheets.add(sheet.part);
    await removeRels(context, "xl/workbook.xml", (rel) => rel.id === sheet.rid);
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
    await removeRels(context, "xl/workbook.xml", (rel) => rel.id === link.rid);
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
      .filter((col) => truthy.has(attr(col, "hidden") ?? ""))
      .map((col) => [Number(attr(col, "min")), Number(attr(col, "max"))]);

    for (const row of descendants(document, "row")) {
      const rowIsHidden = truthy.has(attr(row, "hidden") ?? "");

      for (const cell of children(row, "c")) {
        const column = columnNumber(/^[A-Z]+/.exec(attr(cell, "r") ?? "")?.[0] ?? "");

        if ((rowsHidden && rowIsHidden) || (colsHidden && columns.some(([min, max]) => column >= min && column <= max))) {
          drop(cell);
        }
      }
    }

    // Comments: legacy and threaded, with the drawing that shows the legacy ones.
    const goneComments = await removeRels(context, sheet.part, (rel) => {
      const type = lastSegment(rel.type);

      return (type === "comments" || type === "threadedComment") && hidden.has(`comments-${rel.target}`);
    });

    if (goneComments.some((rel) => lastSegment(rel.type) === "comments")) {
      await removeRels(context, sheet.part, (rel) => lastSegment(rel.type) === "vmlDrawing");

      for (const legacy of descendants(document, "legacyDrawing")) {
        drop(legacy);
      }
    }
  }
}

/** Hidden slides, and the comment parts of slides. */
async function removePptxHidden(context: Context): Promise<void> {
  const { hidden } = context;
  const presentation = await editPart(context, "ppt/presentation.xml");
  const slideRids = new Set<string>();

  for (const slide of presentation ? descendants(presentation, "sldId") : []) {
    const id = attr(slide, "id") ?? "";

    if (hidden.has(`slide-${id}`)) {
      slideRids.add(attr(slide, "r:id") ?? "");
      drop(slide);
    }
  }

  await removeRels(context, "ppt/presentation.xml", (rel) => slideRids.has(rel.id));

  for (const relsPart of zipNames(context).filter((name) => /^ppt\/slides\/_rels\//.test(name))) {
    await removeRels(context, ownerOf(relsPart), (rel) => !rel.external && hidden.has(`comments-${rel.target}`));
  }
}

/** Applies the text edits: the first node of each span gets the placeholder, the others lose their overlapped text. */
function applyTextEdits(context: Context, edits: Edit[]): void {
  const byNode = new Map<Element, Edit[]>();

  for (const entry of edits) {
    appendTo(byNode, entry.node, entry);
  }

  for (const [node, list] of byNode) {
    let text = node.textContent ?? "";

    for (const entry of list.sort((a, b) => b.from - a.from)) {
      text = text.slice(0, entry.from) + (entry.placeholder ? PLACEHOLDER : "") + text.slice(entry.to);
    }

    setText(node, text);
    context.touched.add(list[0].part);

    if (node.nodeName.startsWith("w:")) {
      node.setAttribute("xml:space", "preserve");
    }
  }
}

/** XLSX cells: inline [REDACTED]; dependents are flagged, not rewritten. */
async function redactXlsxCells(context: Context): Promise<void> {
  const { pkg, sheets, deadSheets, redactedCells, notes } = context;
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

        if (formulaReads(formula, sheet.name, target.slice(0, at), target.slice(at + 1))) {
          const note = `${context.input.fileName}: ${sheet.name}!${ref} uses redacted cell ${target}; its formula was not rewritten.`;

          if (!flagged.has(note)) {
            flagged.add(note);
            notes.push({ kind: "formula-dependency", note });
          }
        }
      }
    }
  }

  for (const [part, refs] of redactedCells) {
    const document = await editPart(context, part);

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

/** Always (R17): identity metadata, custom data, and the calc chain. */
function removeMetadata(context: Context): void {
  for (const name of zipNames(context)) {
    if (/^docProps\/(core|app|custom)\.xml$/.test(name) || /^docProps\/thumbnail\./.test(name) || name.startsWith("customXml/") || name === "xl/calcChain.xml") {
      context.zip.remove(name);
    }
  }
}

/** Authors and persons that no comment part uses any more. */
async function removeUnusedAuthors(context: Context): Promise<void> {
  const { format } = context.input;

  if (format === "pptx" && !zipNames(context).some((name) => /^ppt\/comments\/[^/]+\.xml$/.test(name))) {
    await removeRels(context, "ppt/presentation.xml", (rel) => ["commentAuthors", "authors"].includes(lastSegment(rel.type)));
  }

  if (format === "xlsx") {
    const threaded = await Promise.all(
      zipNames(context)
        .filter((name) => name.startsWith("xl/worksheets/"))
        .map((name) => relationships(context.pkg, name)),
    );

    if (!threaded.flat().some((rel) => lastSegment(rel.type) === "threadedComment")) {
      await removeRels(context, "xl/workbook.xml", (rel) => lastSegment(rel.type) === "person");
    }
  }
}

/** Replaces `frame` with a text box that says the object was removed. */
function replaceFrame(format: DocumentRedactionInput["format"], document: Document, frame: Element): void {
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
}

/** R18: charts, SmartArt and embedded objects that contain redacted text are replaced, not rewritten. */
async function replaceObjects(context: Context): Promise<void> {
  const { pkg, zip, spans, notes } = context;
  const { model, format } = context.input;
  const quotes = [...new Set(spans.map((span) => normalizeText(model.text.slice(span.start, span.end))).filter((quote) => quote.length >= RESIDUE_MIN_NEEDLE))];

  const owners = quotes.length === 0 ? [] : zipNames(context).filter((name) => /\.xml$/.test(name) && !objectDirs.some((dir) => name.includes(dir)) && zip.file(relsPathOf(name)));

  for (const owner of owners) {
    const rels = await relationships(pkg, owner);
    const objectRels = rels.filter((rel) => !rel.external && objectDirs.some((dir) => `/${rel.target}`.includes(dir)));

    if (objectRels.length === 0) {
      continue;
    }

    const document = await pkg.xml(owner);
    const frames = (document ? elementsOf(document) : []).filter((element) => ["drawing", "object", "graphicFrame"].includes(element.localName ?? ""));

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

      const found = texts.map(normalizeText);

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

      const labels = mine.flatMap((rel) => {
        const kind = objectKind(rel.target);

        return kind ? [`${kind} ${rel.target}`] : [];
      });

      const label = labels[0] ?? `Object ${mine[0].target}`;

      replaceFrame(format, document, frame);

      // Drop the relationships the frame used, unless something else in the owner still points at them.
      const stillUsed = relationshipIds(document);

      await removeRels(context, owner, (rel) => (used.has(rel.id) || extra.has(rel.id)) && !stillUsed.has(rel.id));
      context.touched.add(owner);
      notes.push({ kind: "object-removed", note: `${context.input.fileName}: ${label} removed: it contained redacted text.` });
    }
  }
}

/** Embedded images: OCR words under a span, and approved regions. */
async function redactImages(context: Context): Promise<void> {
  const { zip, spans } = context;
  const { model, regions } = context.input;
  const boxes = new Map<string, Box[]>();

  for (const word of model.words) {
    if (spans.some((span) => word.start < span.end && word.end > span.start)) {
      appendTo(boxes, word.anchor, word.box);
    }
  }

  for (const region of regions) {
    appendTo(boxes, region.anchor, region.box);
  }

  for (const [anchor, list] of boxes) {
    const image = model.images.find((entry) => imageAnchor(entry.id) === anchor);
    const file = image ? zip.file(image.id) : null;

    if (image && file && image.mime) {
      zip.file(image.id, await redactImage({ bytes: await file.async("uint8array"), mime: image.mime, boxes: list }));
    }
  }
}

/** XLSX: keeps only shared strings some cell still uses, and renumbers. */
async function pruneSharedStrings(context: Context): Promise<void> {
  const stringsPart = "xl/sharedStrings.xml";

  if (context.input.format !== "xlsx" || !context.zip.file(stringsPart)) {
    return;
  }

  const strings = await editPart(context, stringsPart);
  const root = strings?.documentElement;
  const items = root ? children(root, "si") : [];
  const refs: Element[] = [];

  for (const name of zipNames(context).filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry))) {
    const document = await editPart(context, name);

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

/** Writes the changed parts back and builds a new archive from the kept parts only (KTD4). */
async function rebuild(context: Context): Promise<Uint8Array> {
  const { pkg, zip, touched } = context;

  // Content types of parts that are gone.
  const types = await editPart(context, "[Content_Types].xml");

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

  const out = new JSZip();

  for (const name of ["[Content_Types].xml", ...zipNames(context).filter((entry) => entry !== "[Content_Types].xml")]) {
    out.file(name, await zip.file(name)!.async("uint8array"));
  }

  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function redactOoxml(input: DocumentRedactionInput): Promise<DocumentRedactionResult> {
  const { format } = input;
  const pkg = await loadPackage(input.bytes);
  const workbook = format === "xlsx" ? await pkg.xml("xl/workbook.xml") : null;
  const workbookRels = format === "xlsx" ? await relationships(pkg, "xl/workbook.xml") : [];

  const context: Context = {
    input,
    pkg,
    zip: pkg.zip,
    touched: new Set(),
    notes: [],
    hidden: new Set(input.removeHidden),
    spans: [...input.spans]
      .sort((a, b) => a.start - b.start)
      .reduce<{ start: number; end: number }[]>((merged, span) => {
        const last = merged.at(-1);

        if (last && span.start < last.end) {
          last.end = Math.max(last.end, span.end);
        } else {
          merged.push({ ...span });
        }

        return merged;
      }, []),
    workbookRels,
    sheets: (workbook ? descendants(workbook, "sheet") : []).map((element, index) => ({
      element,
      index,
      name: attr(element, "name") ?? "Sheet",
      rid: attr(element, "r:id") ?? "",
      part: workbookRels.find((rel) => rel.id === attr(element, "r:id"))?.target ?? "",
    })),
    deadSheets: new Set(),
    redactedCells: new Map(),
  };

  const edits = await resolveSpans(context);

  if (format === "docx") {
    await removeDocxHidden(context);
  }

  await removeExternalLinks(context);

  if (format === "xlsx" && workbook) {
    await removeXlsxHidden(context, workbook);
  }

  if (format === "pptx") {
    await removePptxHidden(context);
  }

  applyTextEdits(context, edits);

  if (format === "xlsx") {
    await redactXlsxCells(context);
  }

  removeMetadata(context);
  await sweep(context);
  await removeUnusedAuthors(context);
  await sweep(context);
  await replaceObjects(context);
  await sweep(context);
  await redactImages(context);
  await pruneSharedStrings(context);

  return { bytes: await rebuild(context), notes: context.notes };
}
