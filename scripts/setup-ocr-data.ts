import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Downloads the English OCR language data into the local model directory
// so tesseract.js works with the network off. Run from the repo root:
// bun scripts/setup-ocr-data.ts

const MODEL_DIR = process.env.SENTINEL_TESSERACT_MODEL_DIR ?? join("workspace", "models", "tesseract");

const FILE = "eng.traineddata";

const SOURCE = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata";

async function main(): Promise<void> {
  await mkdir(MODEL_DIR, { recursive: true });

  try {
    const existing = await stat(join(MODEL_DIR, FILE));

    if (existing.size > 100_000) {
      console.log(`${FILE} is already present.`);

      return;
    }
  } catch {
    // Missing file: download it below.
  }

  const response = await fetch(SOURCE);

  if (response.ok === false) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const { writeFile } = await import("node:fs/promises");
  const bytes = new Uint8Array(await response.arrayBuffer());

  await writeFile(join(MODEL_DIR, FILE), bytes);
  console.log(`Wrote ${join(MODEL_DIR, FILE)} (${bytes.length} bytes).`);
}

await main();
