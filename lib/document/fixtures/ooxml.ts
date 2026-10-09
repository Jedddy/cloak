import JSZip from "jszip";
import sharp from "sharp";

// Small but valid OOXML packages from fictional data, for tests and the
// fixture script. Pure: no file or network I/O.

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const NS_R = `xmlns:r="${REL}"`;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A tiny valid PNG. */
export async function tinyPng(): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();

  return new Uint8Array(buffer);
}

async function zipOf(files: Map<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const [path, data] of files) {
    zip.file(path, data);
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function relationships(entries: { id: string; type: string; target: string; external?: boolean }[]): string {
  const rows = entries.map((entry) => {
    const mode = entry.external ? ' TargetMode="External"' : "";

    return `<Relationship Id="${entry.id}" Type="${entry.type}" Target="${esc(entry.target)}"${mode}/>`;
  });

  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.join("")}</Relationships>`;
}

function contentTypes(overrides: Map<string, string>): string {
  const rows = [...overrides].map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`);

  return (
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    `${rows.join("")}</Types>`
  );
}

type Properties = { author?: string; lastModifiedBy?: string };

function propertyParts(properties: Properties) {
  const creator = properties.author ? `<dc:creator>${esc(properties.author)}</dc:creator>` : "";
  const modifiedBy = properties.lastModifiedBy ? `<cp:lastModifiedBy>${esc(properties.lastModifiedBy)}</cp:lastModifiedBy>` : "";

  return {
    "docProps/core.xml":
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `${creator}${modifiedBy}</cp:coreProperties>`,
    "docProps/app.xml": `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Fixture</Application></Properties>`,
  };
}

const propertyTypes = {
  "docProps/core.xml": "application/vnd.openxmlformats-package.core-properties+xml",
  "docProps/app.xml": "application/vnd.openxmlformats-officedocument.extended-properties+xml",
};

const NS_C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

const chartType = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

/** A chart part whose title is `text`. */
function chartPart(text: string): string {
  return (
    `${XML}<c:chartSpace ${NS_C} ${NS_A}><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(text)}</a:t></a:r></a:p>` +
    "</c:rich></c:tx></c:title><c:plotArea><c:layout/></c:plotArea></c:chart></c:chartSpace>"
  );
}

/** The `a:graphic` element that points at a chart relationship. */
function chartGraphic(id: string): string {
  return (
    `<a:graphic ${NS_A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart ${NS_C} r:id="${id}"/></a:graphicData></a:graphic>`
  );
}

function packageRels(mainTarget: string): string {
  return relationships([
    { id: "rId1", type: `${REL}/officeDocument`, target: mainTarget },
    {
      id: "rId2",
      type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
      target: "docProps/core.xml",
    },
    { id: "rId3", type: `${REL}/extended-properties`, target: "docProps/app.xml" },
  ]);
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export type DocxOptions = {
  paragraphs?: string[];
  /** One paragraph with one run per entry. */
  splitRuns?: string[];
  /** Rows of cells. */
  table?: string[][];
  header?: string;
  insertions?: { id: number; author: string; text: string }[];
  deletions?: { id: number; author: string; text: string }[];
  comments?: { id: number; author: string; text: string }[];
  /** Runs with a tracked formatting change (w:rPrChange). */
  formatChanges?: { id: number; author: string; text: string }[];
  /** Tracked moves: the `from` text is a w:moveFrom, the `to` text a w:moveTo, each with range markers. */
  moves?: { id: number; author: string; from: string; to: string }[];
  /** Complex fields (fldChar); the instruction is split over two w:instrText nodes when `split` is set. */
  fields?: { instr: string; result: string; split?: boolean }[];
  /** Simple fields (w:fldSimple). */
  simpleFields?: { instr: string; result: string }[];
  /** Runs with w:vanish. */
  vanishRun?: string;
  /** Runs coloured FFFFFF. */
  whiteRun?: string;
  /** External hyperlink target. */
  hyperlink?: string;
  /** Adds a SmartArt data part. */
  smartArt?: boolean;
  /** Adds a chart whose title is this text. */
  chart?: string;
  /** Embeds a PNG and a GIF-named media part. */
  image?: boolean;
  author?: string;
  lastModifiedBy?: string;
};

function run(text: string, properties = ""): string {
  const rPr = properties ? `<w:rPr>${properties}</w:rPr>` : "";

  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export async function buildDocx(options: DocxOptions = {}): Promise<Uint8Array> {
  const body: string[] = [];

  for (const paragraph of options.paragraphs ?? []) {
    body.push(`<w:p>${run(paragraph)}</w:p>`);
  }

  if (options.splitRuns) {
    body.push(`<w:p>${options.splitRuns.map((text) => run(text)).join("")}</w:p>`);
  }

  if (options.table) {
    const rows = options.table.map((cells) => {
      const tcs = cells.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p>${run(cell)}</w:p></w:tc>`);

      return `<w:tr>${tcs.join("")}</w:tr>`;
    });

    body.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid/>${rows.join("")}</w:tbl>`);
  }

  for (const change of options.insertions ?? []) {
    const attrs = `w:id="${change.id}" w:author="${esc(change.author)}" w:date="2026-01-02T03:04:05Z"`;

    body.push(`<w:p><w:ins ${attrs}>${run(change.text)}</w:ins></w:p>`);
  }

  for (const change of options.deletions ?? []) {
    const attrs = `w:id="${change.id}" w:author="${esc(change.author)}" w:date="2026-01-02T03:04:05Z"`;

    body.push(`<w:p><w:del ${attrs}><w:r><w:delText xml:space="preserve">${esc(change.text)}</w:delText></w:r></w:del></w:p>`);
  }

  for (const comment of options.comments ?? []) {
    const reference = `<w:r><w:commentReference w:id="${comment.id}"/></w:r>`;

    body.push(
      `<w:p><w:commentRangeStart w:id="${comment.id}"/>${run("Commented text")}<w:commentRangeEnd w:id="${comment.id}"/>${reference}</w:p>`,
    );
  }

  for (const change of options.formatChanges ?? []) {
    const attrs = `w:id="${change.id}" w:author="${esc(change.author)}" w:date="2026-01-02T03:04:05Z"`;

    body.push(`<w:p>${run(change.text, `<w:b/><w:rPrChange ${attrs}><w:rPr/></w:rPrChange>`)}</w:p>`);
  }

  for (const move of options.moves ?? []) {
    const attrs = `w:author="${esc(move.author)}" w:date="2026-01-02T03:04:05Z"`;
    const out = move.id * 10;
    const into = move.id * 10 + 1;

    body.push(
      `<w:p><w:moveFromRangeStart w:id="${out}" w:name="move${move.id}" ${attrs}/>` +
        `<w:moveFrom w:id="${out + 2}" ${attrs}><w:r><w:delText xml:space="preserve">${esc(move.from)}</w:delText></w:r></w:moveFrom>` +
        `<w:moveFromRangeEnd w:id="${out}"/></w:p>`,
      `<w:p><w:moveToRangeStart w:id="${into}" w:name="move${move.id}" ${attrs}/>` +
        `<w:moveTo w:id="${into + 2}" ${attrs}>${run(move.to)}</w:moveTo><w:moveToRangeEnd w:id="${into}"/></w:p>`,
    );
  }

  for (const field of options.fields ?? []) {
    const half = Math.ceil(field.instr.length / 2);
    const parts = field.split ? [field.instr.slice(0, half), field.instr.slice(half)] : [field.instr];
    const codes = parts.map((part) => `<w:r><w:instrText xml:space="preserve">${esc(part)}</w:instrText></w:r>`).join("");

    body.push(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>${codes}<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `${run(field.result)}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    );
  }

  for (const field of options.simpleFields ?? []) {
    body.push(`<w:p><w:fldSimple w:instr="${esc(field.instr)}">${run(field.result)}</w:fldSimple></w:p>`);
  }

  if (options.vanishRun) {
    body.push(`<w:p>${run(options.vanishRun, "<w:vanish/>")}</w:p>`);
  }

  if (options.whiteRun) {
    body.push(`<w:p>${run(options.whiteRun, '<w:color w:val="FFFFFF"/>')}</w:p>`);
  }

  if (options.hyperlink) {
    body.push(`<w:p><w:hyperlink r:id="rIdLink">${run("A link")}</w:hyperlink></w:p>`);
  }

  if (options.image) {
    body.push(
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        '<wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="Picture 1"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
    );
  }

  if (options.chart) {
    body.push(
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        '<wp:extent cx="190500" cy="190500"/><wp:docPr id="2" name="Chart 1"/>' +
        `${chartGraphic("rIdChart")}</wp:inline></w:drawing></w:r></w:p>`,
    );
  }

  const headerReference = options.header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : "";

  const document =
    `${XML}<w:document ${W} ${NS_R}><w:body>${body.join("")}` +
    `<w:sectPr>${headerReference}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;

  const overrides = new Map(
  Object.entries({
    ...propertyTypes,
    "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  }),
);

  const rels = [];

  const files = new Map<string, string | Uint8Array>(
  Object.entries({
    "word/document.xml": document,
    ...propertyParts(options),
  }),
);

  if (options.header) {
    files.set("word/header1.xml", `${XML}<w:hdr ${W}><w:p>${run(options.header)}</w:p></w:hdr>`);
    overrides.set("word/header1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml");
    rels.push({ id: "rIdHeader", type: `${REL}/header`, target: "header1.xml" });
  }

  if (options.comments?.length) {
    const comments = options.comments.map(
      (comment) =>
        `<w:comment w:id="${comment.id}" w:author="${esc(comment.author)}" w:date="2026-01-02T03:04:05Z" w:initials="X">` +
        `<w:p>${run(comment.text)}</w:p></w:comment>`,
    );

    files.set("word/comments.xml", `${XML}<w:comments ${W}>${comments.join("")}</w:comments>`);
    overrides.set("word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml");
    rels.push({ id: "rIdComments", type: `${REL}/comments`, target: "comments.xml" });
  }

  if (options.hyperlink) {
    rels.push({ id: "rIdLink", type: `${REL}/hyperlink`, target: options.hyperlink, external: true });
  }

  if (options.image) {
    files.set("word/media/image1.png", await tinyPng());
    files.set("word/media/image2.gif", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
    rels.push({ id: "rIdImage", type: `${REL}/image`, target: "media/image1.png" });
  }

  if (options.smartArt) {
    files.set("word/diagrams/data1.xml", `${XML}<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/></dgm:dataModel>`);
    overrides.set("word/diagrams/data1.xml", "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml");
    rels.push({ id: "rIdDiagram", type: `${REL}/diagramData`, target: "diagrams/data1.xml" });
  }

  if (options.chart) {
    files.set("word/charts/chart1.xml", chartPart(options.chart));
    overrides.set("word/charts/chart1.xml", chartType);
    rels.push({ id: "rIdChart", type: `${REL}/chart`, target: "charts/chart1.xml" });
  }

  files.set("word/_rels/document.xml.rels", relationships(rels));
  files.set("[Content_Types].xml", contentTypes(overrides));
  files.set("_rels/.rels", packageRels("word/document.xml"));

  return zipOf(files);
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** `text` or `number` is the value (the cached result when there is a formula). */
export type XlsxCell = { text?: string; number?: number; formula?: string };

export type XlsxSheet = {
  name: string;
  state?: "hidden" | "veryHidden";
  /** Cells by reference, for example `B4`. */
  cells: Record<string, XlsxCell>;
  hiddenRows?: number[];
  /** 1-based inclusive column ranges. */
  hiddenCols?: [number, number][];
  comments?: { ref: string; author: string; text: string }[];
  /** Adds a chart whose title is this text. */
  chart?: string;
};

export type XlsxOptions = {
  sheets: XlsxSheet[];
  /** Targets of external workbooks, index 1 is the first. */
  externalLinks?: string[];
  definedNames?: { name: string; ref: string; localSheetId?: number }[];
  /** Pivot caches: sourced from a sheet (`sheet=`) or a defined name (`name=`), with `secret` in the shared items and records. A pivot table on `table` (a sheet name) uses the cache. */
  pivotCaches?: { sheet?: string; name?: string; secret: string; table?: string }[];
  author?: string;
  lastModifiedBy?: string;
};

function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let index = 0;

  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }

  return index;
}

export async function buildXlsx(options: XlsxOptions): Promise<Uint8Array> {
  const shared: string[] = [];

  const overrides = new Map(
  Object.entries({
    ...propertyTypes,
    "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "xl/sharedStrings.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
  }),
);

  const files = new Map<string, string | Uint8Array>(Object.entries(propertyParts(options)));
  const workbookRels = [{ id: "rIdStrings", type: `${REL}/sharedStrings`, target: "sharedStrings.xml" }];

  const sheetTags = options.sheets.map((sheet, index) => {
    const n = index + 1;
    const state = sheet.state ? ` state="${sheet.state}"` : "";
    const sheetRels = [];

    const byRow = new Map<number, [string, XlsxCell][]>();

    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const row = Number(ref.replace(/\D+/g, ""));

      byRow.set(row, [...(byRow.get(row) ?? []), [ref, cell]]);
    }

    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, cells]) => {
        const hidden = sheet.hiddenRows?.includes(row) ? ' hidden="1"' : "";

        const cellTags = cells
          .sort((a, b) => columnIndex(a[0]) - columnIndex(b[0]))
          .map(([ref, cell]) => {
            const formula = cell.formula === undefined ? "" : `<f>${esc(cell.formula)}</f>`;

            if (cell.number !== undefined) {
              return `<c r="${ref}">${formula}<v>${cell.number}</v></c>`;
            }

            if (cell.formula !== undefined) {
              return `<c r="${ref}" t="str">${formula}<v>${esc(cell.text ?? "")}</v></c>`;
            }

            const text = cell.text ?? "";

            if (!shared.includes(text)) {
              shared.push(text);
            }

            return `<c r="${ref}" t="s"><v>${shared.indexOf(text)}</v></c>`;
          });

        return `<row r="${row}"${hidden}>${cellTags.join("")}</row>`;
      });

    const cols = (sheet.hiddenCols ?? []).map(([min, max]) => `<col min="${min}" max="${max}" width="9" hidden="1"/>`);
    const colsTag = cols.length > 0 ? `<cols>${cols.join("")}</cols>` : "";
    const legacy = sheet.comments?.length ? '<legacyDrawing r:id="rIdVml"/>' : "";

    if (sheet.comments?.length) {
      const authors = [...new Set(sheet.comments.map((comment) => comment.author))];

      const list = sheet.comments.map(
        (comment) =>
          `<comment ref="${comment.ref}" authorId="${authors.indexOf(comment.author)}"><text><r><t>${esc(comment.text)}</t></r></text></comment>`,
      );

      files.set(`xl/comments${n}.xml`, `${XML}<comments ${S}><authors>${authors.map((a) => `<author>${esc(a)}</author>`).join("")}</authors>` +
        `<commentList>${list.join("")}</commentList></comments>`);
      files.set(`xl/drawings/vmlDrawing${n}.vml`, '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"></xml>');
      overrides.set(`xl/comments${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml");
      sheetRels.push({ id: "rIdComments", type: `${REL}/comments`, target: `../comments${n}.xml` });
      sheetRels.push({ id: "rIdVml", type: `${REL}/vmlDrawing`, target: `../drawings/vmlDrawing${n}.vml` });
    }

    let drawing = "";

    if (sheet.chart) {
      const anchor = "<xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff>";

      files.set(
        `xl/drawings/drawing${n}.xml`,
        `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${NS_R}>` +
          `<xdr:twoCellAnchor><xdr:from>${anchor}</xdr:from><xdr:to>${anchor}</xdr:to>` +
          '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
          `<xdr:xfrm><a:off ${NS_A} x="0" y="0"/><a:ext ${NS_A} cx="0" cy="0"/></xdr:xfrm>${chartGraphic("rId1")}</xdr:graphicFrame>` +
          "<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>",
      );
      files.set(`xl/drawings/_rels/drawing${n}.xml.rels`, relationships([{ id: "rId1", type: `${REL}/chart`, target: `../charts/chart${n}.xml` }]));
      files.set(`xl/charts/chart${n}.xml`, chartPart(sheet.chart));
      overrides.set(`xl/charts/chart${n}.xml`, chartType);
      overrides.set(`xl/drawings/drawing${n}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml");
      sheetRels.push({ id: "rIdDrawing", type: `${REL}/drawing`, target: `../drawings/drawing${n}.xml` });
      drawing = '<drawing r:id="rIdDrawing"/>';
    }

    files.set(`xl/worksheets/sheet${n}.xml`, `${XML}<worksheet ${S} ${NS_R}>${colsTag}<sheetData>${rows.join("")}</sheetData>${drawing}${legacy}</worksheet>`);
    overrides.set(`xl/worksheets/sheet${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
    workbookRels.push({ id: `rIdSheet${n}`, type: `${REL}/worksheet`, target: `worksheets/sheet${n}.xml` });

    if (sheetRels.length > 0) {
      files.set(`xl/worksheets/_rels/sheet${n}.xml.rels`, relationships(sheetRels));
    }

    return `<sheet name="${esc(sheet.name)}" sheetId="${n}"${state} r:id="rIdSheet${n}"/>`;
  });

  const links = options.externalLinks ?? [];

  links.forEach((target, index) => {
    const n = index + 1;

    files.set(`xl/externalLinks/externalLink${n}.xml`, `${XML}<externalLink ${S} ${NS_R}><externalBook r:id="rId1"><sheetNames><sheetName val="Sheet1"/></sheetNames></externalBook></externalLink>`);
    files.set(`xl/externalLinks/_rels/externalLink${n}.xml.rels`, relationships([
      { id: "rId1", type: `${REL}/externalLinkPath`, target, external: true },
    ]));
    overrides.set(`xl/externalLinks/externalLink${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml");
    workbookRels.push({ id: `rIdExt${n}`, type: `${REL}/externalLink`, target: `externalLinks/externalLink${n}.xml` });
  });

  const externalTags = links.map((_, index) => `<externalReference r:id="rIdExt${index + 1}"/>`);
  const externalList = externalTags.length > 0 ? `<externalReferences>${externalTags.join("")}</externalReferences>` : "";

  const names = (options.definedNames ?? []).map((item) => {
    const local = item.localSheetId === undefined ? "" : ` localSheetId="${item.localSheetId}"`;

    return `<definedName name="${esc(item.name)}"${local}>${esc(item.ref)}</definedName>`;
  });

  const namesTag = names.length > 0 ? `<definedNames>${names.join("")}</definedNames>` : "";

  const caches = options.pivotCaches ?? [];

  caches.forEach((cache, index) => {
    const n = index + 1;
    const source = cache.sheet === undefined ? `<worksheetSource name="${esc(cache.name ?? "")}"/>` : `<worksheetSource ref="A1:A2" sheet="${esc(cache.sheet)}"/>`;

    files.set(
      `xl/pivotCache/pivotCacheDefinition${n}.xml`,
      `${XML}<pivotCacheDefinition ${S} ${NS_R} r:id="rId1" recordCount="1"><cacheSource type="worksheet">${source}</cacheSource>` +
        `<cacheFields count="1"><cacheField name="Margin" numFmtId="0"><sharedItems count="1"><s v="${esc(cache.secret)}"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`,
    );
    files.set(`xl/pivotCache/_rels/pivotCacheDefinition${n}.xml.rels`, relationships([{ id: "rId1", type: `${REL}/pivotCacheRecords`, target: `pivotCacheRecords${n}.xml` }]));
    files.set(`xl/pivotCache/pivotCacheRecords${n}.xml`, `${XML}<pivotCacheRecords ${S} count="1"><r><x v="0"/></r><r><s v="${esc(cache.secret)}"/></r></pivotCacheRecords>`);
    overrides.set(`xl/pivotCache/pivotCacheDefinition${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml");
    overrides.set(`xl/pivotCache/pivotCacheRecords${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml");
    workbookRels.push({ id: `rIdPivot${n}`, type: `${REL}/pivotCacheDefinition`, target: `pivotCache/pivotCacheDefinition${n}.xml` });

    if (cache.table !== undefined) {
      const sheetNumber = options.sheets.findIndex((sheet) => sheet.name === cache.table) + 1;

      files.set(
        `xl/pivotTables/pivotTable${n}.xml`,
        `${XML}<pivotTableDefinition ${S} name="PivotTable${n}" cacheId="${n}" dataCaption="Values"><location ref="D1:D2" firstHeaderRow="1" firstDataRow="1" firstDataCol="0"/>` +
          '<pivotFields count="1"><pivotField axis="axisRow" showAll="0"><items count="2"><item x="0"/><item t="default"/></items></pivotField></pivotFields>' +
          '<rowFields count="1"><field x="0"/></rowFields><rowItems count="2"><i><x/></i><i t="grand"><x/></i></rowItems></pivotTableDefinition>',
      );
      files.set(`xl/pivotTables/_rels/pivotTable${n}.xml.rels`, relationships([{ id: "rId1", type: `${REL}/pivotCacheDefinition`, target: `../pivotCache/pivotCacheDefinition${n}.xml` }]));
      overrides.set(`xl/pivotTables/pivotTable${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml");

      const sheetRelsPart = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`;
      const existing = files.get(sheetRelsPart);
      // SAFETY: only relationship parts are stored under this path, and they are strings.
      const before = existing === undefined ? undefined : (existing as string);
      const entry = `<Relationship Id="rIdPivotTable${n}" Type="${REL}/pivotTable" Target="../pivotTables/pivotTable${n}.xml"/>`;

      files.set(
        sheetRelsPart,
        before ? before.replace("</Relationships>", `${entry}</Relationships>`) : relationships([{ id: `rIdPivotTable${n}`, type: `${REL}/pivotTable`, target: `../pivotTables/pivotTable${n}.xml` }]),
      );
    }
  });

  const cacheTags = caches.map((_, index) => `<pivotCache cacheId="${index + 1}" r:id="rIdPivot${index + 1}"/>`);
  const cacheList = cacheTags.length > 0 ? `<pivotCaches>${cacheTags.join("")}</pivotCaches>` : "";

  files.set("xl/workbook.xml", `${XML}<workbook ${S} ${NS_R}><sheets>${sheetTags.join("")}</sheets>${externalList}${namesTag}${cacheList}</workbook>`);
  files.set("xl/_rels/workbook.xml.rels", relationships(workbookRels));
  files.set("xl/sharedStrings.xml", `${XML}<sst ${S} count="${shared.length}" uniqueCount="${shared.length}">` +
    `${shared.map((text) => `<si><t xml:space="preserve">${esc(text)}</t></si>`).join("")}</sst>`);
  files.set("[Content_Types].xml", contentTypes(overrides));
  files.set("_rels/.rels", packageRels("xl/workbook.xml"));

  return zipOf(files);
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

const P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ${NS_R} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

export type PptxSlide = {
  texts: string[];
  notes?: string;
  hidden?: boolean;
  /** Adds a chart whose title is this text. */
  chart?: string;
};

export type PptxOptions = {
  slides: PptxSlide[];
  /** `slide` is 1-based. */
  comments?: { slide: number; author: string; text: string }[];
  author?: string;
  lastModifiedBy?: string;
};

const emptyTree =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function textBox(id: number, name: string, texts: string[], placeholder = ""): string {
  const paragraphs = texts.map((text) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(text)}</a:t></a:r></a:p>`);

  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>` +
    '<p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join("")}</p:txBody></p:sp>`
  );
}

const colorMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const theme =
  `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements>` +
  '<a:clrScheme name="Fixture"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="DC2626"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="CA8A04"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="9333EA"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Fixture">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  "</a:fmtScheme></a:themeElements></a:theme>";

export async function buildPptx(options: PptxOptions): Promise<Uint8Array> {
  const overrides = new Map(
  Object.entries({
    ...propertyTypes,
    "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "ppt/slideMasters/slideMaster1.xml": "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
    "ppt/slideLayouts/slideLayout1.xml": "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
    "ppt/notesMasters/notesMaster1.xml": "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
    "ppt/theme/theme1.xml": "application/vnd.openxmlformats-officedocument.theme+xml",
    "ppt/theme/theme2.xml": "application/vnd.openxmlformats-officedocument.theme+xml",
  }),
);

  const files = new Map<string, string | Uint8Array>(
  Object.entries({
    ...propertyParts(options),
    "ppt/theme/theme1.xml": theme,
    "ppt/theme/theme2.xml": theme,
    "ppt/slideMasters/slideMaster1.xml":
      `${XML}<p:sldMaster ${P}><p:cSld><p:spTree>${emptyTree}${textBox(2, "Title", ["Master title"])}</p:spTree></p:cSld>${colorMap}` +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
      { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" },
    ]),
    "ppt/slideLayouts/slideLayout1.xml":
      `${XML}<p:sldLayout ${P} type="blank"><p:cSld name="Fixture layout"><p:spTree>${emptyTree}${textBox(2, "Title", ["Layout title"])}</p:spTree></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([
      { id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" },
    ]),
    "ppt/notesMasters/notesMaster1.xml":
      `${XML}<p:notesMaster ${P}><p:cSld><p:spTree>${emptyTree}</p:spTree></p:cSld>${colorMap}</p:notesMaster>`,
    "ppt/notesMasters/_rels/notesMaster1.xml.rels": relationships([
      { id: "rId1", type: `${REL}/theme`, target: "../theme/theme2.xml" },
    ]),
  }),
);

  const presentationRels = [
    { id: "rIdMaster", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" },
    { id: "rIdNotesMaster", type: `${REL}/notesMaster`, target: "notesMasters/notesMaster1.xml" },
  ];

  const slideIds: string[] = [];

  options.slides.forEach((slide, index) => {
    const n = index + 1;
    const show = slide.hidden ? ' show="0"' : "";
    const slideRels = [{ id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }];

    let frame = "";

    if (slide.chart) {
      frame =
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
        '<p:xfrm><a:off x="457200" y="1800000"/><a:ext cx="4000000" cy="2000000"/></p:xfrm>' +
        `${chartGraphic("rIdChart")}</p:graphicFrame>`;
      files.set(`ppt/charts/chart${n}.xml`, chartPart(slide.chart));
      overrides.set(`ppt/charts/chart${n}.xml`, chartType);
      slideRels.push({ id: "rIdChart", type: `${REL}/chart`, target: `../charts/chart${n}.xml` });
    }

    files.set(`ppt/slides/slide${n}.xml`, `${XML}<p:sld ${P}${show}><p:cSld><p:spTree>${emptyTree}${textBox(2, "Text", slide.texts)}${frame}</p:spTree></p:cSld></p:sld>`);
    overrides.set(`ppt/slides/slide${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    presentationRels.push({ id: `rIdSlide${n}`, type: `${REL}/slide`, target: `slides/slide${n}.xml` });
    slideIds.push(`<p:sldId id="${255 + n}" r:id="rIdSlide${n}"/>`);

    if (slide.notes !== undefined) {
      files.set(`ppt/notesSlides/notesSlide${n}.xml`, `${XML}<p:notes ${P}><p:cSld><p:spTree>${emptyTree}${textBox(2, "Notes", [slide.notes])}</p:spTree></p:cSld></p:notes>`);
      files.set(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relationships([
        { id: "rId1", type: `${REL}/notesMaster`, target: "../notesMasters/notesMaster1.xml" },
        { id: "rId2", type: `${REL}/slide`, target: `../slides/slide${n}.xml` },
      ]));
      overrides.set(`ppt/notesSlides/notesSlide${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
      slideRels.push({ id: "rId2", type: `${REL}/notesSlide`, target: `../notesSlides/notesSlide${n}.xml` });
    }

    const comments = (options.comments ?? []).filter((comment) => comment.slide === n);

    if (comments.length > 0) {
      const rows = comments.map((comment, at) => {
        const authorId = [...new Set((options.comments ?? []).map((c) => c.author))].indexOf(comment.author);

        return (
          `<p:cm authorId="${authorId}" dt="2026-01-02T03:04:05.000" idx="${at + 1}"><p:pos x="10" y="10"/>` +
          `<p:text>${esc(comment.text)}</p:text></p:cm>`
        );
      });

      files.set(`ppt/comments/comment${n}.xml`, `${XML}<p:cmLst ${P}>${rows.join("")}</p:cmLst>`);
      overrides.set(`ppt/comments/comment${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.comments+xml");
      slideRels.push({ id: "rId3", type: `${REL}/comments`, target: `../comments/comment${n}.xml` });
    }

    files.set(`ppt/slides/_rels/slide${n}.xml.rels`, relationships(slideRels));
  });

  if (options.comments?.length) {
    const authors = [...new Set(options.comments.map((comment) => comment.author))];

    const rows = authors.map(
      (author, id) => `<p:cmAuthor id="${id}" name="${esc(author)}" initials="X" lastIdx="1" clrIdx="${id}"/>`,
    );

    files.set("ppt/commentAuthors.xml", `${XML}<p:cmAuthorLst ${P}>${rows.join("")}</p:cmAuthorLst>`);
    overrides.set("ppt/commentAuthors.xml", "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml");
    presentationRels.push({ id: "rIdAuthors", type: `${REL}/commentAuthors`, target: "commentAuthors.xml" });
  }

  files.set("ppt/presentation.xml", `${XML}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>` +
    '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst>' +
    `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  files.set("ppt/_rels/presentation.xml.rels", relationships(presentationRels));
  files.set("[Content_Types].xml", contentTypes(overrides));
  files.set("_rels/.rels", packageRels("ppt/presentation.xml"));

  return zipOf(files);
}
