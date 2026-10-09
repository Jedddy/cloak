import type { Document, Element } from "@xmldom/xmldom";

import type { DocumentSection } from "@/lib/contract/schemas";
import { columnName, columnNumber } from "@/lib/utils";

import {
  attr,
  children,
  descendants,
  pieceReader,
  relationships,
  requiredXml,
  textNodes,
  type ModelBuilder,
  type Pkg,
  type Piece,
  type Relationship,
} from "./ooxml";
import { shortHash } from "./shared";

// XLSX extraction. Each cell is one whole-cell segment (node -1).
// Comment parts use text nodes `t` (legacy) or `text` (threaded); a
// segment's `node` indexes textNodes(part, names) with those names.

export const truthy = new Set(["1", "true"]);

/** Text node names of a comment part: threaded comments use `text`, legacy ones `t`. */
export const xlsxCommentNames = (threaded: boolean) => (threaded ? ["text"] : ["t"]);

/** Text node names of the workbook part: each defined name is one node, with its name attribute and formula text. */
export const xlsxWorkbookNames = ["definedName"];

/** Hidden item id of a defined name; scoped names carry their sheet index. */
export function definedNameId(name: Element): string {
  const local = attr(name, "localSheetId");

  return `name-${local === null ? "" : `${local}:`}${attr(name, "name") ?? ""}`;
}

/** Built-in names such as Print_Area are text for detection but not hidden items. */
export const isBuiltInName = (name: string) => name.startsWith("_xlnm.");

export type PivotCache = {
  part: string;
  /** Hidden item id. */
  id: string;
  /** Relationship id and cache id in workbook.xml ("" when the workbook does not list it). */
  rid: string;
  cacheId: string;
  /** Sheets named by the cache source (worksheet source or consolidation ranges). */
  sheets: string[];
  /** Defined name or table the cache reads from. */
  name: string | null;
  /** What the cache reads from, for the note. */
  source: string;
};

/** Pivot cache definitions of the package, with what they read from; shared with the redactor so ids agree. */
export async function pivotCaches(pkg: Pkg, workbook: Document, workbookRels: Relationship[]): Promise<PivotCache[]> {
  const out: PivotCache[] = [];

  for (const part of pkg.names.filter((entry) => /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(entry))) {
    const definition = await pkg.xml(part);
    const rid = workbookRels.find((rel) => rel.target === part)?.id ?? "";
    const listed = descendants(workbook, "pivotCache").find((entry) => rid !== "" && attr(entry, "r:id") === rid);
    const origin = definition ? descendants(definition, "cacheSource")[0] : undefined;
    const sources = origin ? descendants(origin, "worksheetSource").concat(descendants(origin, "rangeSet")) : [];
    const sheets = sources.flatMap((entry) => attr(entry, "sheet") ?? []);
    const name = sources.map((entry) => attr(entry, "name")).find((value) => value !== null) ?? null;

    out.push({
      part,
      id: `pivot-${part}`,
      rid,
      cacheId: listed ? (attr(listed, "cacheId") ?? "") : "",
      sheets,
      name,
      source: sheets[0] ?? name ?? (origin ? attr(origin, "type") : null) ?? "an unknown source",
    });
  }

  return out;
}

/** Text of a shared string item or inline string: its `t`, or the `t` of each run. */
function richText(element: Element): string {
  return children(element)
    .flatMap((child) => (child.localName === "r" ? children(child, "t") : [child]))
    .filter((child) => child.localName === "t")
    .map((child) => child.textContent ?? "")
    .join("");
}

function fileName(target: string): string {
  const name = target.split(/[\\/]/).pop() ?? target;

  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export async function extractXlsx(pkg: Pkg, builder: ModelBuilder): Promise<void> {
  const workbook = await requiredXml(pkg, "xl/workbook.xml");
  const workbookRels = await relationships(pkg, "xl/workbook.xml");
  const target = (id: string | null) => workbookRels.find((rel) => rel.id === id)?.target ?? "";

  const stringsDocument = await pkg.xml("xl/sharedStrings.xml");
  const strings = stringsDocument ? descendants(stringsDocument, "si").map(richText) : [];

  // External workbooks, 1-based in workbook.xml order.
  const links: { name: string; target: string; definedNames: string[] }[] = [];

  for (const reference of descendants(workbook, "externalReference")) {
    const part = target(attr(reference, "r:id"));
    const external = (await relationships(pkg, part)).find((rel) => rel.external);

    links.push({ name: fileName(external?.target ?? part), target: external?.target ?? part, definedNames: [] });
  }

  const rewrite = (formula: string) =>
    formula.replace(/\[(\d+)\]/g, (match, n: string) => (links[Number(n) - 1] ? `[${links[Number(n) - 1].name}]` : match));

  for (const name of descendants(workbook, "definedName")) {
    for (const match of (name.textContent ?? "").matchAll(/\[(\d+)\]/g)) {
      links[Number(match[1]) - 1]?.definedNames.push(attr(name, "name") ?? "");
    }
  }

  for (const link of links) {
    const used = link.definedNames.length > 0 ? `, used by defined name ${link.definedNames.map((n) => `'${n}'`).join(", ")}` : "";

    builder.hide({
      id: `extlink-${shortHash(link.target)}`,
      kind: "external-link",
      note: `External link to ${link.name}${used}`,
      quote: link.name,
      category: "hidden-data",
    });
  }

  const personsPart = workbookRels.find((rel) => rel.type.endsWith("/person"))?.target;
  const persons = new Map<string, string>();

  for (const person of personsPart ? descendants((await pkg.xml(personsPart)) ?? workbook, "person") : []) {
    persons.set(attr(person, "id") ?? "", attr(person, "displayName") ?? "");
  }

  for (const sheet of descendants(workbook, "sheet")) {
    const name = attr(sheet, "name") ?? "Sheet";
    const part = target(attr(sheet, "r:id"));
    const document = await requiredXml(pkg, part);
    const state = attr(sheet, "state");
    const hiddenSheet = state === "hidden" || state === "veryHidden";
    const grid = builder.section(name, "grid", hiddenSheet);
    const hiddenRows: string[] = [];

    if (hiddenSheet) {
      builder.hide({ id: `sheet-${name}`, kind: "hidden-sheet", note: `Hidden sheet '${name}'`, quote: name, category: "hidden-data" });
    }

    for (const row of descendants(document, "row")) {
      if (truthy.has(attr(row, "hidden") ?? "")) {
        hiddenRows.push(attr(row, "r") ?? "");
      }

      for (const cell of children(row, "c")) {
        const ref = attr(cell, "r") ?? "";
        const match = /^([A-Z]+)(\d+)$/.exec(ref);
        const formula = children(cell, "f")[0]?.textContent ?? "";
        const raw = children(cell, "v")[0]?.textContent ?? "";
        const type = attr(cell, "t");
        let value = raw;

        if (type === "s") {
          value = strings[Number(raw)] ?? "";
        } else if (type === "inlineStr") {
          value = richText(children(cell, "is")[0] ?? cell);
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        }

        const text = formula === "" ? value : `=${rewrite(formula)} ${value}`.trimEnd();

        if (match) {
          const col = columnNumber(match[1]) - 1;
          const piece: Piece = { text, part, node: -1, cell: ref };

          builder.item(grid, `${name}!${ref}`, Number(match[2]) - 1, col, [piece]);
        }
      }
    }

    if (hiddenRows.length > 0) {
      builder.hide({
        id: `rows-${name}`,
        kind: "hidden-rows",
        note: `Hidden rows in sheet '${name}': ${hiddenRows.join(", ")}`,
        quote: null,
        category: "hidden-data",
      });
    }

    const hiddenCols = descendants(document, "col")
      .filter((col) => truthy.has(attr(col, "hidden") ?? ""))
      .map((col) => {
        const min = Number(attr(col, "min"));
        const max = Number(attr(col, "max"));

        return min === max ? columnName(min) : `${columnName(min)}-${columnName(max)}`;
      });

    if (hiddenCols.length > 0) {
      builder.hide({
        id: `cols-${name}`,
        kind: "hidden-rows",
        note: `Hidden columns in sheet '${name}': ${hiddenCols.join(", ")}`,
        quote: null,
        category: "hidden-data",
      });
    }

    // Comments: legacy and threaded.
    const comments: DocumentSection = builder.section(`Comments: ${name}`, "flow", hiddenSheet);

    for (const rel of await relationships(pkg, part)) {
      const threaded = rel.type.endsWith("/threadedComment");

      if (!threaded && !rel.type.endsWith("/comments")) {
        continue;
      }

      const commentsDocument = await pkg.xml(rel.target);

      if (!commentsDocument) {
        continue;
      }

      const piecesOf = pieceReader(commentsDocument, xlsxCommentNames(threaded), rel.target);
      const listed = descendants(commentsDocument, "author").map((author) => author.textContent ?? "");
      const authors: string[] = [];

      for (const comment of descendants(commentsDocument, threaded ? "threadedComment" : "comment")) {
        const author = threaded ? persons.get(attr(comment, "personId") ?? "") : listed[Number(attr(comment, "authorId"))];

        authors.push(author ?? "unknown author");
        builder.item(comments, `${name}!${attr(comment, "ref") ?? ""}`, null, null, piecesOf(comment));
      }

      const unique = [...new Set(authors)];

      builder.hide({
        id: `comments-${rel.target}`,
        kind: "comment",
        note: `Comments in sheet '${name}' by ${unique.join(", ")}`,
        quote: unique[0] ?? null,
        category: "hidden-data",
      });
    }
  }

  // Defined names: their text goes to detection, and each non-built-in one is a hidden item.
  const names = descendants(workbook, "definedName");
  const nameIndex = new Map(textNodes(workbook, xlsxWorkbookNames).map((node, at) => [node, at]));
  const nameSection = builder.section("Defined names", "flow");

  for (const element of names) {
    const name = attr(element, "name") ?? "";
    const formula = rewrite(element.textContent ?? "");
    const node = nameIndex.get(element) ?? -1;

    builder.item(
      nameSection,
      `Defined name ${name}`,
      null,
      null,
      [
        { text: name, part: "xl/workbook.xml", node },
        { text: formula, part: "xl/workbook.xml", node },
      ],
      " = ",
    );

    if (!isBuiltInName(name)) {
      builder.hide({
        id: definedNameId(element),
        kind: "defined-name",
        note: `Defined name '${name}' = ${formula}`,
        quote: name,
        category: "hidden-data",
      });
    }
  }

  for (const cache of await pivotCaches(pkg, workbook, workbookRels)) {
    builder.hide({ id: cache.id, kind: "pivot-cache", note: `Pivot cache from ${cache.source}`, quote: cache.sheets[0] ?? null, category: "hidden-data" });
  }
}
