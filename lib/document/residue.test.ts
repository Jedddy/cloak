import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
import * as mupdf from "mupdf";

import { buildPdf } from "./fixtures/pdf";
import { residue } from "./residue";

const pdfWith = (build: (doc: mupdf.PDFDocument) => void) => {
  const doc = new mupdf.PDFDocument(buildPdf({ pages: [{ lines: ["Visible text"] }] }));

  build(doc);

  const bytes = doc.saveToBuffer("compress").asUint8Array().slice();

  doc.destroy();

  return bytes;
};

const zipOf = (parts: Record<string, string>) => {
  const zip = new JSZip();

  for (const [name, xml] of Object.entries(parts)) {
    zip.file(name, xml);
  }

  return zip.generateAsync({ type: "uint8array" });
};

describe("residue PDF", () => {
  test("finds text the page shows, ignoring case and spacing", async () => {
    const bytes = buildPdf({ pages: [{ lines: ["Contract with Acme Corp signed"] }] });

    expect(await residue({ format: "pdf", bytes, needles: ["ACME   corp", "Other Name"] })).toEqual(["ACME   corp"]);
  });

  test("AE8: finds a needle that lives only in a compressed stream pdfjs never renders", async () => {
    const bytes = pdfWith((doc) => {
      doc.getTrailer().get("Root").put("Unused", doc.addStream("/Note (Acme Corp ledger)", {}));
    });

    expect(await residue({ format: "pdf", bytes, needles: ["Acme Corp", "Zebra"] })).toEqual(["Acme Corp"]);
  });

  test("finds a needle in a stream the file compressed itself, and in UTF-16BE and hex strings", async () => {
    const utf16 = Buffer.from("Acme Corp", "utf16le").swap16();
    const hex = Buffer.from("Beta Works", "latin1").toString("hex").toUpperCase();

    const body = Buffer.concat([Buffer.from("/A <FEFF"), Buffer.from(utf16.toString("hex")), Buffer.from("> /B <" + hex + ">")]);

    const bytes = pdfWith((doc) => {
      doc.getTrailer().get("Root").put("Unused", doc.addRawStream(deflateSync(body), { Filter: "FlateDecode" }));
    });

    expect(await residue({ format: "pdf", bytes, needles: ["acme corp", "BETA WORKS", "Gamma Co"] })).toEqual(["acme corp", "BETA WORKS"]);
  });

  test("finds a needle written as a #20-escaped PDF name", async () => {
    const bytes = pdfWith((doc) => {
      doc.getTrailer().get("Root").put("Unused", doc.addObject({ Name: doc.newName("Zebra layer") }));
    });

    expect(await residue({ format: "pdf", bytes, needles: ["Zebra layer"] })).toEqual(["Zebra layer"]);
  });

  test("ignores needles under 3 characters, and returns each needle once", async () => {
    const bytes = buildPdf({ pages: [{ lines: ["Contract with Acme Corp signed"] }] });

    expect(await residue({ format: "pdf", bytes, needles: ["Ac", " c ", "Acme", "Acme"] })).toEqual(["Acme"]);
  });
});

describe("residue OOXML", () => {
  test("finds a needle split across runs, and decodes entities", async () => {
    const bytes = await zipOf({
      "word/document.xml": "<w:p><w:r><w:t>Ac</w:t></w:r><w:r><w:t>me</w:t></w:r><w:r><w:t> Tom &amp; Jerry</w:t></w:r></w:p>",
      "docProps/core.xml": "<cp:coreProperties><dc:creator>Pat Doe</dc:creator></cp:coreProperties>",
      "word/media/image1.png": "Hidden Zebra",
    });

    expect(await residue({ format: "docx", bytes, needles: ["Acme", "tom & jerry", "Pat Doe", "Hidden Zebra", "Nobody"] })).toEqual([
      "Acme",
      "tom & jerry",
      "Pat Doe",
    ]);
  });

  test("finds text in relationship targets", async () => {
    const bytes = await zipOf({
      "word/_rels/document.xml.rels": '<Relationships><Relationship Target="https://intranet.example.test/a"/></Relationships>',
      "word/document.xml": "<w:p><w:r><w:t>plain</w:t></w:r></w:p>",
    });

    expect(await residue({ format: "docx", bytes, needles: ["intranet.example.test", "unrelated"] })).toEqual(["intranet.example.test"]);
  });
});

test("an OOXML needle that is only an element name is not residue", async () => {
  const zip = new JSZip();

  zip.file("word/document.xml", '<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Kept</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');

  const bytes = await zip.generateAsync({ type: "uint8array" });

  expect(await residue({ format: "docx", bytes, needles: ["body", "document"] })).toEqual([]);
});
