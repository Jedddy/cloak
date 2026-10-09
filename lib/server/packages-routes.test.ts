import { expect, test } from "bun:test";

import { POST as uploadFile } from "@/app/api/packages/[id]/files/route";
import { PATCH as updateFile } from "@/app/api/packages/[id]/files/[fileId]/route";
import { POST as createPackage } from "@/app/api/packages/route";
import { fixtureRecipients } from "@/lib/contract/fixtures";
import { FileEntrySchema, PackageSchema, type Package } from "@/lib/contract/schemas";

import { getPackageDetail } from "./packages";
import { updatePackage, writeRecipients } from "./store";
import { withTempWorkspace } from "./testing";

withTempWorkspace();

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
