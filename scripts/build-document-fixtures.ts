import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDocx, buildPptx, buildXlsx } from "../lib/document/fixtures/ooxml";
import { buildEncryptedPdf, buildPdf } from "../lib/document/fixtures/pdf";

// Creates fixtures/documents/: one PDF, DOCX, XLSX, and PPTX with the hidden
// content the document acceptance tests look for, plus an encrypted PDF. All
// data is fictional. Run from the repo root: bun scripts/build-document-fixtures.ts

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "documents");

const files = {
  "brief.pdf": buildPdf({
    pages: [
      { lines: ["Project Juniper brief", "Prepared for the contractor handoff."] },
      { type3: true, image: true, lines: ["Acme Corp"], note: { author: "J. Cruz", contents: "Check the Acme rate before sending." } },
      { lines: ["Next steps", "Review the schedule with the team."] },
    ],
    info: { Author: "J. Cruz", Title: "Juniper brief" },
    attachment: { name: "rates.txt", text: "Day rate for Acme Corp: 1,450 EUR\n" },
  }),
  "encrypted.pdf": buildEncryptedPdf(),
  "proposal.docx": await buildDocx({
    paragraphs: ["Proposal for the Juniper handoff", "Scope and schedule follow."],
    table: [
      ["Client", "Rate"],
      ["Acme Corp", "1,450 EUR"],
    ],
    insertions: [
      { id: 1, author: "J. Cruz", text: "Kickoff is planned for March." },
      { id: 2, author: "J. Cruz", text: "Weekly reviews follow the kickoff." },
    ],
    comments: [{ id: 1, author: "M. Reyes", text: "Confirm the figures before sending." }],
    smartArt: true,
    image: true,
    author: "M. Reyes",
    lastModifiedBy: "M. Reyes",
  }),
  "pricing.xlsx": await buildXlsx({
    sheets: [
      {
        name: "Rates",
        cells: {
          A1: { text: "Item" },
          B1: { text: "Rate" },
          A2: { text: "Design" },
          B2: { number: 900 },
          A4: { text: "Base rate" },
          B4: { formula: "[1]Sheet1!A1", number: 1450 },
        },
      },
      { name: "Margins", state: "veryHidden", cells: { A1: { text: "Internal margin" }, B1: { number: 0.35 } } },
    ],
    externalLinks: ["ClientX_rates.xlsx"],
    author: "M. Reyes",
  }),
  "deck.pptx": await buildPptx({
    slides: [
      { texts: ["Juniper kickoff"] },
      { texts: ["Timeline"] },
      { texts: ["Pricing"], notes: "don't mention the Globex discount" },
      { texts: ["Internal appendix"], hidden: true },
    ],
    author: "M. Reyes",
  }),
} satisfies Record<string, Uint8Array>;

await mkdir(out, { recursive: true });

for (const [name, bytes] of Object.entries(files)) {
  await writeFile(join(out, name), bytes);
}
