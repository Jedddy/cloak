# Document fixtures

Fictional documents for the end-to-end acceptance tests (`lib/server/documents.e2e.test.ts`). Rebuild with
`bun scripts/build-document-fixtures.ts`.

- `brief.pdf`: 3 pages. Page 2 uses a Type3 font, has a picture, and says "Acme Corp". It also has a sticky note by "J. Cruz", an
  attached file (`rates.txt`), and document properties.
- `encrypted.pdf`: AES-256 encrypted with a user password. Stored as unsupported ("Encrypted PDF").
- `proposal.docx`: two tracked insertions by "J. Cruz", one comment, a SmartArt diagram, an embedded PNG, and "Acme Corp" in a table cell.
- `pricing.xlsx`: a veryHidden sheet "Margins", `Rates!B4` = `=[ClientX_rates.xlsx]Sheet1!A1` through an external link, shared strings.
- `deck.pptx`: slide 3 notes say "don't mention the Globex discount", and slide 4 is hidden.
