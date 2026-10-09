import { expect, mock, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";

import { POST as uploadFile } from "@/app/api/packages/[id]/files/route";
import { PATCH as updateFile } from "@/app/api/packages/[id]/files/[fileId]/route";
import { POST as createPackage } from "@/app/api/packages/route";
import { documentLayer } from "@/lib/document";
import { buildPdf } from "@/lib/document/fixtures/pdf";
import { buildXlsx } from "@/lib/document/fixtures/ooxml";
import { workspacePaths } from "./paths";
import { fixtureRecipients } from "@/lib/contract/fixtures";
import { DocumentModelSchema, FileEntrySchema, documentFormat, PackageSchema, type Package } from "@/lib/contract/schemas";

import { getPackageDetail } from "./packages";
import { addOriginal, updatePackage, writeDocument, writeExportManifest, writeRecipients } from "./store";
import { withTempWorkspace } from "./testing";

withTempWorkspace();

// connection() only works inside a Next.js request; GET routes call it first, so the tests stand in for it.
const nextServer = await import("next/server");

mock.module("next/server", () => ({ ...nextServer, connection: async () => undefined }));

const { GET: getFileDocument } = await import("@/app/api/packages/[id]/files/[fileId]/document/route");

const { GET: getFilePage } = await import("@/app/api/packages/[id]/files/[fileId]/pages/[page]/route");

const { GET: getReviewedDocument } = await import("@/app/api/packages/[id]/reviewed/[fileId]/document/route");

const { GET: getReviewedPage } = await import("@/app/api/packages/[id]/reviewed/[fileId]/pages/[page]/route");

async function newPackage(): Promise<Package> {
  await writeRecipients(fixtureRecipients);

  const response = await createPackage(
    new Request("http://127.0.0.1/api/packages", {
      method: "POST",
      body: JSON.stringify({ name: "Handoff", recipientId: "recipient-northwind" }),
    }),
  );

  return PackageSchema.parse(await response.json());
}

function upload(packageId: string, files: File[]) {
  const form = new FormData();

  for (const file of files) {
    form.append("file", file);
  }

  return uploadFile(new Request(`http://127.0.0.1/api/packages/${packageId}/files`, { method: "POST", body: form }), {
    params: Promise.resolve({ id: packageId }),
  });
}

test("create a package, upload 2 files, and read 2 file entries with sha256 and size", async () => {
  const pkg = await newPackage();

  for (const name of ["notes.md", "spec.md"]) {
    const response = await upload(pkg.id, [new File([`# ${name}\n`], name)]);

    expect(response.status).toBe(200);
  }

  const detail = await getPackageDetail(pkg.id);

  expect(detail.package.files).toHaveLength(2);

  for (const file of detail.package.files) {
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.sizeBytes).toBe(`# ${file.originalName}\n`.length);
  }
});

test("an upload with two files in one body returns 400", async () => {
  const pkg = await newPackage();
  const response = await upload(pkg.id, [new File(["a"], "a.txt"), new File(["b"], "b.txt")]);

  expect(response.status).toBe(400);
  expect((await getPackageDetail(pkg.id)).package.files).toHaveLength(0);
});

test("a package left in scanning with no live job returns its previous status and an interrupted flag", async () => {
  const pkg = await newPackage();

  await updatePackage(pkg.id, (current) => ({ ...current, status: "scanning" }));

  const detail = await getPackageDetail(pkg.id);

  expect(detail.package.status).toBe("draft");
  expect(detail.interrupted).toBe(true);
  expect((await getPackageDetail(pkg.id)).interrupted).toBe(true);
});

test("PATCH a file sets excluded", async () => {
  const pkg = await newPackage();
  const entry = FileEntrySchema.parse(await (await upload(pkg.id, [new File(["a"], "a.txt")])).json());

  const response = await updateFile(
    new Request("http://127.0.0.1/", { method: "PATCH", body: JSON.stringify({ excluded: true }) }),
    { params: Promise.resolve({ id: pkg.id, fileId: entry.id }) },
  );

  expect(FileEntrySchema.parse(await response.json()).excluded).toBe(true);
  expect((await getPackageDetail(pkg.id)).package.files[0]?.excluded).toBe(true);
});

const documentParams = (id: string, fileId: string) => ({ params: Promise.resolve({ id, fileId }) });

const pageParams = (id: string, fileId: string, page: string) => ({ params: Promise.resolve({ id, fileId, page }) });

const get = (path: string) => new Request(`http://127.0.0.1${path}`);

/** Adds a file and caches its extracted model, as a scan would (no OCR needed). */
async function scannedDocument(packageId: string, name: string, bytes: Uint8Array): Promise<string> {
  const file = await addOriginal(packageId, { name, bytes });

  await writeDocument(packageId, file.id, await documentLayer.extract({ fileName: name, format: documentFormat(file.mime) ?? "pdf", bytes }));

  return file.id;
}

test("GET document for a scanned XLSX returns two sheets, one hidden, with offsets into the text", async () => {
  const pkg = await newPackage();

  const bytes = await buildXlsx({
    sheets: [
      { name: "Summary", cells: { A1: { text: "Quarterly figures" } } },
      { name: "Margins", state: "hidden", cells: { B4: { text: "Secret margin" } } },
    ],
  });

  const fileId = await scannedDocument(pkg.id, "book.xlsx", bytes);
  const response = await getFileDocument(get("/"), documentParams(pkg.id, fileId));
  const model = DocumentModelSchema.parse(await response.json());
  const sheets = model.sections.filter((section) => section.kind === "grid");

  expect(response.status).toBe(200);
  expect(sheets.map((sheet) => [sheet.title, sheet.hidden])).toEqual([
    ["Summary", false],
    ["Margins", true],
  ]);
  expect(model.text.slice(sheets[1]?.items[0]?.start, sheets[1]?.items[0]?.end)).toBe("Secret margin");
});

test("GET document is not-found for a text file and conflict when the document is not scanned", async () => {
  const pkg = await newPackage();
  const note = await addOriginal(pkg.id, { name: "n.md", bytes: new TextEncoder().encode("hi") });
  const book = await addOriginal(pkg.id, { name: "b.xlsx", bytes: await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "x" } } }] }) });

  expect((await getFileDocument(get("/"), documentParams(pkg.id, note.id))).status).toBe(404);

  const unscanned = await getFileDocument(get("/"), documentParams(pkg.id, book.id));

  expect(unscanned.status).toBe(409);
  // SAFETY: respond() writes the shared ApiError body for a conflict.
  expect(((await unscanned.json()) as { error: { message: string } }).error.message).toBe("Scan the package to see this document.");
});

test("GET pages/2 of a 3-page PDF is a PNG and is cached; pages/9, pages/0, and pages/x are not-found", async () => {
  const pkg = await newPackage();
  const bytes = buildPdf({ pages: [{ lines: ["one"] }, { lines: ["two"] }, { lines: ["three"] }] });
  const fileId = await scannedDocument(pkg.id, "deck.pdf", bytes);

  const first = await getFilePage(get("/"), pageParams(pkg.id, fileId, "2"));
  const png = new Uint8Array(await first.arrayBuffer());

  expect(first.status).toBe(200);
  expect(first.headers.get("Content-Type")).toBe("image/png");
  expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);

  // The second request is served from derived/<file-id>.p2.png: a changed cache file proves it.
  await Bun.write(workspacePaths.pageRender(pkg.id, fileId, 2), "cached");

  const second = await getFilePage(get("/"), pageParams(pkg.id, fileId, "2"));

  expect(await second.text()).toBe("cached");

  for (const page of ["9", "0", "x", "1.5"]) {
    expect((await getFilePage(get("/"), pageParams(pkg.id, fileId, page))).status).toBe(404);
  }

  expect(await Bun.file(workspacePaths.pageRender(pkg.id, fileId, 9)).exists()).toBe(false);
});

test("GET pages is not-found for a non-PDF document", async () => {
  const pkg = await newPackage();
  const bytes = await buildXlsx({ sheets: [{ name: "S", cells: { A1: { text: "x" } } }] });
  const fileId = await scannedDocument(pkg.id, "book.xlsx", bytes);

  expect((await getFilePage(get("/"), pageParams(pkg.id, fileId, "1"))).status).toBe(404);
});

test("the reviewed document and page routes are not-found before export", async () => {
  const pkg = await newPackage();
  const fileId = await scannedDocument(pkg.id, "deck.pdf", buildPdf({ pages: [{ lines: ["one"] }] }));

  expect((await getReviewedDocument(get("/"), documentParams(pkg.id, fileId))).status).toBe(404);
  expect((await getReviewedPage(get("/"), pageParams(pkg.id, fileId, "1"))).status).toBe(404);
});

test("the reviewed document and page routes read the reviewed copy after export", async () => {
  const pkg = await newPackage();
  const bytes = buildPdf({ pages: [{ lines: ["one"] }, { lines: ["two"] }] });
  const fileId = await scannedDocument(pkg.id, "deck.pdf", bytes);

  await writeExportManifest(pkg.id, [{ fileId, name: "deck.pdf" }]);
  await mkdir(workspacePaths.reviewedDir(pkg.id), { recursive: true });
  await writeFile(workspacePaths.reviewed(pkg.id, "deck.pdf"), bytes);

  const model = DocumentModelSchema.parse(await (await getReviewedDocument(get("/"), documentParams(pkg.id, fileId))).json());
  const page = await getReviewedPage(get("/"), pageParams(pkg.id, fileId, "2"));

  expect(model.pages).toHaveLength(2);
  expect(page.headers.get("Content-Type")).toBe("image/png");
  expect((await getReviewedPage(get("/"), pageParams(pkg.id, fileId, "3"))).status).toBe(404);
});
