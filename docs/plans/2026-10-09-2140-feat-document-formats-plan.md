---
title: Document Formats (PDF, DOCX, XLSX, PPTX) - Plan
type: feat
date: 2026-10-09
topic: document-formats
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Document Formats (PDF, DOCX, XLSX, PPTX) - Plan

## Goal Capsule

- **Objective:** A user can put PDF, DOCX, XLSX, and PPTX files in a package, review what they reveal to the recipient, and export reviewed copies that are still working documents with the approved content removed, and that pass verification.
- **Product authority:** `PRODUCT.md` and `sentineldesk-overview.md`, as amended by R1 of this plan. Glossary terms come from `CONTEXT.md`.
- **Open blockers:** none for planning. The product-scope change (R1) has to land before or with the first implementation unit, so that judges and teammates are not reading a contradicting `PRODUCT.md`.

---

## Product Contract

### Summary

Cloak adds four document kinds: PDF, DOCX, XLSX, and PPTX. Each one goes through the same detection layers as text and images. Hidden content becomes a finding. Export removes approved content from the document itself, not just from what is visible. When removal of a region cannot be verified, Cloak flattens only that page or object to pixels and says so in coverage.

### Problem Frame

Freelancer handoffs are mostly proposals, SOWs, pricing sheets, and decks, not screenshots. Today Cloak lists these files as "not supported". The user still has to send them without review, and those files are where "other clients", internal pricing, and tracked-change author names leak. The original scope left these formats out because PDF redaction tools routinely leak text through glyph positions (overview §154). This plan takes them on, and makes verification strict enough that the success copy stays true.

### Key Decisions

- **Native redaction, not inspection-only.** The reviewed copy stays an editable document, which overturns the "out of scope" line in `PRODUCT.md`. (session-settled: user-directed — chosen over inspect-only S8, flatten-whole-file, and text-extraction-only: recipients need working documents.) Governs R1, R11–R17.
- **All four formats in one plan.** (session-settled: user-directed — chosen over one-format-first, DOCX recommended: one coherent "documents" capability.) Each format still has its own acceptance examples, so no format's verification is weakened to match the others. Governs R2.
- **Unverifiable regions flatten locally, not whole-file.** (session-settled: user-approved — chosen over blocking export and flattening the whole file: keeps the rest of the document native while staying honest.) Governs R18, R19.
- **Hidden content is findings, default remove.** (session-settled: user-approved — chosen over silent strip and split policy: matches the existing structure-check layer, and the user can keep things they meant to send.) Governs R7–R10.
- **PDF previews as rendered pages, Office as a structured view.** (session-settled: user-approved — chosen over LibreOffice rendering and text-only: no heavy local install, and PDF keeps visual context and manual boxes.) Governs R21–R23.
- **Legacy binary Office (`.doc`/`.xls`/`.ppt`) and ODF stay unsupported.** (session-settled: user-directed — only PPTX added to the three named formats.)

### Requirements

**Product scope**

- R1. `PRODUCT.md` (Capabilities → Inputs, Out of scope, Positioning) and `sentineldesk-overview.md` (out-of-scope list, S8) are updated to say Cloak inspects and natively redacts PDF, DOCX, XLSX, and PPTX. "Does not compete on PDF/Office PII redaction" is reworded to recipient-aware review rather than removed silently.
- R2. Supported document kinds are PDF, DOCX, XLSX, and PPTX, recognised by extension plus a content check. A mismatch between name and content, an encrypted or password-protected file, or a macro-enabled variant (`.docm`, `.xlsm`, `.pptm`) is stored as unsupported with a specific reason.

**Inspection**

- R3. All text the recipient could reach is analysed by the rules, protected-term, and LLM layers, with exact-quote evidence that points to a location: PDF page, DOCX paragraph or table cell, XLSX sheet and cell, PPTX slide and shape.
- R4. XLSX analysis covers cell values, and also formula text and cached results, because a formula can name another sheet or workbook.
- R5. PPTX analysis covers slide text, speaker notes, and slide-layout or master text.
- R6. Embedded images in any document, and PDF pages that have no extractable text layer, go through the existing OCR and vision layers, with findings attributed back to their page or object.
- R7. Hidden content produces a structure finding with evidence. This includes comments, tracked changes (with author names), hidden sheets/rows/columns, white or zero-size or off-page text, document properties and XMP metadata, PDF annotations, form-field values, attachments, and embedded files.
- R8. External links and references (linked workbooks, remote images, hyperlinks to internal hosts) produce a finding, because the target name can reveal a client or system.
- R9. The suggested action for every hidden-content finding (R7, R8) is remove. The user can still choose keep, keep and remember, or not an issue, under the existing decision rules.
- R10. Content Cloak cannot parse inside a supported file, such as SmartArt, OLE objects, charts, or macros, is listed in that file's coverage as "not analysed" with a reason, and is never skipped silently.

**Reviewed copies**

- R11. Originals stay read-only. Each reviewed copy is a new file of the same format that opens in mainstream viewers (Acrobat/Preview, Word, Excel, PowerPoint, LibreOffice).
- R12. A redaction removes the underlying content, not just what is visible. No redacted string survives in text extraction, copy/paste, search, XML parts, content streams, glyph positions, fonts' `ToUnicode` maps, or undo/revision data.
- R13. In PDFs, a redacted text region is removed from the page content and replaced with a solid fill at the same bounds. A manual box removes all text and image content under it.
- R14. In DOCX and PPTX, redacted text is replaced with a fixed-width placeholder that keeps the layout roughly in place. A redacted embedded image is rebuilt through the existing image redactor.
- R15. In XLSX, a redacted cell has its value, formula, and cached result cleared and replaced with the placeholder. Formulas elsewhere that referenced the cell are flagged in coverage, not rewritten.
- R16. Removing hidden content (R7) deletes it from the file: comments, accepted-away revisions (tracked changes are resolved to the visible text), hidden sheets, properties, annotations, attachments.
- R17. Every reviewed copy has document properties and XMP metadata stripped, regardless of findings, matching image export today.

**Fallback and verification**

- R18. When Cloak cannot verify that a native redaction removed the content, it flattens only the affected PDF page or embedded object to pixels, applies the solid fill there, and keeps the rest of the document native.
- R19. Coverage names each flattened page or object and the reason. The user sees this before export and in the export summary.
- R20. Verification re-opens each reviewed copy with an independent extraction path, re-runs detection, and confirms that no approved-redacted string or removed hidden item is still there. A failure blocks the success copy for that file.

**Review surface**

- R21. A PDF previews as page images, with finding boxes and manual boxes, using the existing image-viewer behavior.
- R22. DOCX, XLSX, and PPTX preview in a structured view: paragraphs and tables, a sheet grid with sheet tabs (hidden sheets marked), and slides with their notes. Finding highlights use the existing text-viewer behavior.
- R23. Manual boxes are available on PDF pages only. Office files take manual text selection in the structured view.

**Locality**

- R24. All parsing, rendering, redaction, and verification run on the user's machine with no network calls and no external application install (no LibreOffice, no Office).

### Key Flows

1. **Scan.** The user adds `proposal.docx`, `pricing.xlsx`, `deck.pptx`, and `brief.pdf`. Each is recognised (R2). Text, hidden content, and embedded images are analysed (R3–R8), and anything not analysed is listed (R10).
2. **Review.** The user opens `pricing.xlsx`, sees the grid with the hidden sheet "Margins" marked, and the finding "Hidden sheet 'Margins'" with suggested action remove (R7, R9, R22). They accept it.
3. **Export.** Cloak writes the reviewed copies (R11–R17). One PDF page uses a Type3 font, so its redaction can't be verified, and that page is flattened (R18). The coverage panel says "brief.pdf page 4 flattened: text could not be removed natively" (R19).
4. **Verify.** Re-extraction finds no redacted strings, so the user sees "Reviewed. No open detected findings." with the coverage note (R20).

### Acceptance Examples

- AE1 (Covers R2). Given `report.pdf` that is AES-encrypted, when it is added, it is stored as unsupported with the reason "Encrypted PDF".
- AE2 (Covers R12, R13). Given a PDF where "Acme Corp" is redacted on page 2, when the reviewed copy is opened, `pdftotext`, select-all copy, and a raw content-stream search all return no "Acme Corp", and a black box sits at its former bounds.
- AE3 (Covers R13, R18, R19). Given a PDF page whose redacted text can't be cut natively, when exported, only that page is an image, the other pages still have selectable text, and coverage names the page.
- AE4 (Covers R7, R16). Given a DOCX with two tracked insertions by "J. Cruz" and one comment, when scanned, three hidden-content findings appear. When accepted as remove, the reviewed copy has no `w:ins`/`w:del`/comments parts and no "J. Cruz" anywhere in its XML.
- AE5 (Covers R4, R15). Given an XLSX where cell `B4` = `=[ClientX_rates.xlsx]Sheet1!A1`, when scanned, the external reference produces a finding. When `B4` is redacted, its formula and cached value are both gone.
- AE6 (Covers R5). Given a PPTX whose speaker notes say "don't mention the Globex discount", when "Globex" is a protected term, a finding points to that slide's notes.
- AE7 (Covers R10). Given a DOCX with a SmartArt diagram, coverage lists "SmartArt on page/paragraph N: not analysed".
- AE8 (Covers R20). Given a reviewed copy where a redacted string survives in a font's `ToUnicode` map, verification fails for that file and the success copy is not shown.

### Scope Boundaries

- Legacy binary Office (`.doc`, `.xls`, `.ppt`), ODF (`.odt`, `.ods`, `.odp`), RTF, email files, and archives stay unsupported.
- Macro-enabled files and encrypted files are not opened (R2). Decrypting with a user password is deferred.
- Rewriting formulas that depend on redacted cells is deferred. They are flagged (R15).
- Faithful page rendering of Office files is deferred (it would need LibreOffice, which R24 rules out).
- Digital signatures on PDFs/Office files are not preserved. A reviewed copy is a new document, and coverage says the signature was dropped.

### Dependencies / Assumptions

- Local JS/WASM libraries exist that can parse and rewrite PDF content streams and render PDF pages on the server or in the browser. The choice is deferred to planning.
- OOXML (DOCX/XLSX/PPTX) can be handled as zip + XML with the existing `jszip` dependency.
- Overview §154 (PoPETs 2023 glyph-position leak) is the threat model R12 and R20 are written against.

### Outstanding Questions

**Deferred to Planning**

- Which PDF library gives content-stream-level text removal, and which independent extractor verification uses (R13, R20).
- Placeholder form for R14/R15: fixed `█████`, `[REDACTED]`, or length-matched.
- Whether PDF page rendering happens on the server (sharp/pdfium-WASM) or in the browser (pdf.js), given the local-only network rule (R21, R24).
- Per-file size and page limits for documents, alongside the existing 25 MB upload limit.
- Whether the hackathon demo package (`fixtures/demo-package/`) should gain one document, and which one.

### Sources / Research

- `lib/server/store.ts:332` `detectKind()`: the single point where kinds are decided today. `.pdf` is asserted unsupported in `lib/server/store.test.ts:73` and `lib/server/pipeline.test.ts:173`. Both tests change with this plan.
- `lib/contract/schemas.ts:165` `FileKind`: the contract enum gains the document kinds.
- `lib/redact/image.ts`: reused for embedded images (R14) and flattened pages (R18).
- `sentineldesk-overview.md` §11 (structure checks), §122–138 (competitor formats), §154 (redaction failure research), §213–217 (S8, out-of-scope list).
- `docs/plans/2026-10-09-1558-feat-detection-and-redaction-plan.md`: the existing structure-check and redactor contract this extends.
