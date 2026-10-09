import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FindingCandidate } from "@/lib/contract/schemas";

import { protectedTerms } from "./protected-terms";
import { rules } from "./rules";
import { structure } from "./structure";

// Guards the generated fixtures (scripts/make-fixtures.ts): each demo file
// and each structure fixture must trigger what it was made for.

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

const demo = join(fixturesRoot, "demo-package");

const structural = join(fixturesRoot, "structure");

const utf8 = new TextDecoder("utf-8");

async function scanImage(path: string): Promise<FindingCandidate[]> {
  const bytes = new Uint8Array(await readFile(path));
  const name = path.split("/").pop() ?? path;

  return structure({ fileId: name, fileName: name, kind: "image", bytes, text: null });
}

async function scanText(path: string): Promise<FindingCandidate[]> {
  const bytes = new Uint8Array(await readFile(path));
  const text = utf8.decode(bytes);
  const name = path.split("/").pop() ?? path;
  const found = await structure({ fileId: name, fileName: name, kind: "text", bytes, text });

  return [
    ...found,
    ...(await rules({ fileId: name, fileName: name, text, ocrWords: null })),
    ...(await protectedTerms({
      fileId: name,
      fileName: name,
      text,
      ocrWords: null,
      protectedTerms: ["Juniper"],
      otherClientNames: [],
    })),
  ];
}

function categories(found: FindingCandidate[]): string[] {
  return [...new Set(found.map((item) => item.category))].sort();
}

describe("demo-package fixtures", () => {
  test("screenshot-01 is clean", async () => {
    expect(await scanImage(join(demo, "screenshot-01.png"))).toEqual([]);
  });

  test("screenshot-02 carries trailing data and metadata", async () => {
    expect(categories(await scanImage(join(demo, "screenshot-02.png")))).toEqual(["hidden-data", "metadata"]);
  });

  test("notes mention the protected term and hide zero-width chars", async () => {
    expect(categories(await scanText(join(demo, "notes.md")))).toEqual(["hidden-data", "protected-term", "secret"]);
  });

  test("the env example leaks secrets", async () => {
    expect(categories(await scanText(join(demo, ".env.example")))).toEqual(["secret"]);
  });

  test("spec is clean", async () => {
    expect(await scanText(join(demo, "spec.md"))).toEqual([]);
  });
});

describe("structure fixtures", () => {
  test("each binary fixture triggers its check", async () => {
    expect(categories(await scanImage(join(structural, "png-trailing.png")))).toEqual(["hidden-data"]);
    expect(categories(await scanImage(join(structural, "jpeg-trailing.jpg")))).toEqual(["hidden-data"]);
    expect(categories(await scanImage(join(structural, "with-metadata.jpg")))).toEqual(["metadata"]);
  });

  test("each text fixture triggers its check", async () => {
    expect(categories(await scanText(join(structural, "zero-width.md")))).toEqual(["hidden-data"]);
    expect(categories(await scanText(join(structural, "prompt-injection.md")))).toEqual(["prompt-injection"]);
  });
});
