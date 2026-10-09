import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { fixtureFindings, fixtureRecipients } from "@/lib/contract/fixtures";
import { UPLOAD_LIMITS, type Finding } from "@/lib/contract/schemas";

import { workspacePaths } from "./paths";
import {
  addOriginal,
  createPackage,
  deletePackage,
  readFindings,
  readPackage,
  readProfiles,
  writeFindings,
  writeRecipients,
} from "./store";
import { expectApiError, withTempWorkspace } from "./testing";

withTempWorkspace();

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

  test("a .pdf file is stored as unsupported", async () => {
    const pkg = await newPackage();
    const entry = await addOriginal(pkg.id, { name: "report.pdf", bytes: textBytes });

    expect(entry.kind).toBe("unsupported");
    expect(entry.status).toBe("unsupported");
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
