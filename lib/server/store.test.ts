import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import JSZip from "jszip";

import { fixtureFindings, fixtureRecipients } from "@/lib/contract/fixtures";
import { UPLOAD_LIMITS, type DocumentModel, type Finding } from "@/lib/contract/schemas";

import { workspacePaths } from "./paths";
import {
  addOriginal,
  createPackage,
  deletePackage,
  readFindings,
  readDocument,
  readPackage,
  readProfiles,
  writeDocument,
  writeFindings,
  writeRecipients,
} from "./store";
import { expectApiError, withTempWorkspace } from "./testing";

withTempWorkspace();

async function zipOf(paths: string[]): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const path of paths) {
    zip.file(path, "<x/>");
  }

  return zip.generateAsync({ type: "uint8array" });
}

async function newPackage() {
  await writeRecipients(fixtureRecipients);

  return createPackage({
    name: "Handoff",
    recipientId: fixtureRecipients[0]?.id ?? "",
    protectedTerms: ["Juniper"],
  });
}

const textBytes = new TextEncoder().encode("hello\n");

const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const jpegMagic = [0xff, 0xd8, 0xff, 0xe0];

describe("originals", () => {
  test("an upload named ../../etc/passwd.txt is stored by id inside the package", async () => {
    const pkg = await newPackage();
    const entry = await addOriginal(pkg.id, { name: "../../etc/passwd.txt", bytes: textBytes });
    const files = await readdir(workspacePaths.originalDir(pkg.id));

    expect(files).toEqual([`${entry.id}.txt`]);
    expect(entry.originalName).toBe("../../etc/passwd.txt");
    expect(entry.kind).toBe("text");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = join(workspacePaths.originalDir(pkg.id), files[0] ?? "");

    expect(relative(workspacePaths.package(pkg.id), stored).startsWith("..")).toBe(false);
    expect((await readPackage(pkg.id)).files).toHaveLength(1);
  });

  test("a file over 25 MB is rejected", async () => {
    const pkg = await newPackage();
    const bytes = new Uint8Array(UPLOAD_LIMITS.maxFileBytes + 1);

    await expectApiError(addOriginal(pkg.id, { name: "big.txt", bytes }), "too-large");
  });

  test("the 51st file is rejected", async () => {
    const pkg = await newPackage();

    for (let index = 0; index < UPLOAD_LIMITS.maxFilesPerPackage; index += 1) {
      await addOriginal(pkg.id, { name: `f${index}.txt`, bytes: textBytes });
    }

    await expectApiError(addOriginal(pkg.id, { name: "f50.txt", bytes: textBytes }), "limit-reached");
  });

  test("a .pdf name on non-PDF bytes is stored as unsupported", async () => {
    const pkg = await newPackage();
    const entry = await addOriginal(pkg.id, { name: "report.pdf", bytes: textBytes });

    expect(entry.kind).toBe("unsupported");
    expect(entry.status).toBe("unsupported");
  });

  test("an encrypted PDF is stored as unsupported with a reason", async () => {
    const pkg = await newPackage();

    const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF");
    const entry = await addOriginal(pkg.id, { name: "report.pdf", bytes });

    expect(entry.kind).toBe("unsupported");
    expect(entry.failureReason).toBe("Encrypted PDF");
  });

  test("a PDF with a valid header is stored as a pending document", async () => {
    const pkg = await newPackage();
    const bytes = new TextEncoder().encode("%PDF-1.7\ntrailer << /Root 1 0 R >>\n%%EOF");
    const entry = await addOriginal(pkg.id, { name: "brief.pdf", bytes });

    expect([entry.kind, entry.mime, entry.status]).toEqual(["document", "application/pdf", "pending"]);
    expect(entry.failureReason).toBeNull();
  });

  test("OOXML files are documents when the main part is present", async () => {
    const pkg = await newPackage();

    const docx = await addOriginal(pkg.id, { name: "a.docx", bytes: await zipOf(["word/document.xml"]) });
    const xlsx = await addOriginal(pkg.id, { name: "b.xlsx", bytes: await zipOf(["xl/workbook.xml"]) });
    const pptx = await addOriginal(pkg.id, { name: "c.pptx", bytes: await zipOf(["ppt/presentation.xml"]) });

    expect([docx.kind, xlsx.kind, pptx.kind]).toEqual(["document", "document", "document"]);
    expect(docx.mime).toContain("wordprocessingml");
  });

  test("a .docx zip without word/document.xml is stored as unsupported", async () => {
    const pkg = await newPackage();

    const entry = await addOriginal(pkg.id, { name: "a.docx", bytes: await zipOf(["xl/workbook.xml"]) });

    expect(entry.kind).toBe("unsupported");
    expect(entry.failureReason).toBe("The file name says DOCX, but the content is not a Word document.");
  });

  test("macro-enabled documents are stored as unsupported", async () => {
    const pkg = await newPackage();

    const docm = await addOriginal(pkg.id, { name: "a.docm", bytes: await zipOf(["word/document.xml"]) });
    const withMacro = await addOriginal(pkg.id, { name: "b.docx", bytes: await zipOf(["word/document.xml", "word/vbaProject.bin"]) });

    for (const entry of [docm, withMacro]) {
      expect(entry.kind).toBe("unsupported");
      expect(entry.failureReason).toBe("Macro-enabled documents are not supported.");
    }
  });

  test("an encrypted .xlsx (CFB container) is stored as unsupported", async () => {
    const pkg = await newPackage();
    const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const marker = new Uint8Array(Buffer.from("EncryptionInfo", "utf16le"));
    const bytes = Uint8Array.from([...magic, 0, 0, ...marker, 0, 0]);
    const entry = await addOriginal(pkg.id, { name: "pricing.xlsx", bytes });

    expect(entry.kind).toBe("unsupported");
    expect(entry.failureReason).toBe("Encrypted workbook");
  });

  test("legacy Office extensions are not supported", async () => {
    const pkg = await newPackage();

    for (const name of ["a.doc", "b.xls", "c.ppt"]) {
      const entry = await addOriginal(pkg.id, { name, bytes: textBytes });

      expect(entry.failureReason).toBe("This file type is not supported.");
    }
  });

  test("a .png name on JPEG bytes is stored as unsupported with a reason", async () => {
    const pkg = await newPackage();
    const bytes = Uint8Array.from([...jpegMagic, 0, 0, 0]);
    const entry = await addOriginal(pkg.id, { name: "shot.png", bytes });

    expect(entry.kind).toBe("unsupported");
    expect(entry.failureReason).toContain("PNG");
  });

  test("PNG and JPEG bytes with matching names are images", async () => {
    const pkg = await newPackage();
    const png = await addOriginal(pkg.id, { name: "a.png", bytes: Uint8Array.from(pngMagic) });
    const jpeg = await addOriginal(pkg.id, { name: "b.JPG", bytes: Uint8Array.from(jpegMagic) });

    expect([png.kind, png.mime]).toEqual(["image", "image/png"]);
    expect([jpeg.kind, jpeg.mime]).toEqual(["image", "image/jpeg"]);
  });
});

test("a reader never sees a partial findings.json while it is written", async () => {
  const pkg = await newPackage();
  const small: Finding[] = fixtureFindings.slice(0, 1);

  const large: Finding[] = Array.from({ length: 400 }, (_, index) => ({
    ...fixtureFindings[0],
    id: `fnd-${index}`,
  }));

  await writeFindings(pkg.id, small);

  let writing = true;
  const lengths = new Set<number>();

  const reader = (async () => {
    while (writing) {
      lengths.add((await readFindings(pkg.id)).length);
    }
  })();

  for (let round = 0; round < 40; round += 1) {
    await writeFindings(pkg.id, round % 2 === 0 ? large : small);
  }

  writing = false;
  await reader;

  for (const length of lengths) {
    expect([small.length, large.length]).toContain(length);
  }
});

test("deleting a package removes its whole folder", async () => {
  const pkg = await newPackage();

  await addOriginal(pkg.id, { name: "a.txt", bytes: textBytes });
  await deletePackage(pkg.id);

  const exists = await stat(workspacePaths.package(pkg.id)).then(
    () => true,
    () => false,
  );

  expect(exists).toBe(false);
});

test("profiles are seeded with the three presets on first read", async () => {
  const profiles = await readProfiles();

  expect(profiles.map((profile) => profile.name)).toEqual([
    "External contractor",
    "Client",
    "Public portfolio",
  ]);
});

test("a document model round-trips through derived/<file-id>.document.json", async () => {
  const pkg = await newPackage();

  const model: DocumentModel = {
    format: "docx",
    text: "Hello",
    sections: [],
    segments: [],
    words: [],
    hidden: [],
    images: [],
    notAnalysed: [],
    signed: false,
    pages: [],
  };

  expect(await readDocument(pkg.id, "file1")).toBeNull();

  await writeDocument(pkg.id, "file1", model);

  expect(await readDocument(pkg.id, "file1")).toEqual(model);
  expect(workspacePaths.document(pkg.id, "file1")).toEndWith(join("derived", "file1.document.json"));
});
