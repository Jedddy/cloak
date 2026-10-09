---
title: Detection and Redaction - Plan
type: feat
date: 2026-10-09
topic: detection-and-redaction
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Detection and Redaction - Plan

## Goal Capsule

- **Objective:** Cloak finds secrets, PII, protected terms, hidden data, and metadata in a package with no model, and writes redacted copies that keep no trace of the redacted content.
- **Owner:** Teammate B (Stream 2).
- **Product authority:** `sentineldesk-overview.md` sections 11 (layers 1-4, profile application), 12 (merge), 13 (exact related, inconsistent warning), 14. Interfaces come from `lib/contract/` (Stream 1). Coordination rules are in `docs/plans/2026-10-09-1558-docs-team-split-plan.md`.
- **Open blockers:** Contract v1 (hour 2). Before that, run spikes F3 and F4 and build fixtures.

---

## Product Contract

### Summary

Stream 2 builds every detection layer that needs no AI: structure checks, rules, protected terms, and OCR. It also builds profile application, finding merge, the exact "find related" search, the inconsistent-redaction check, and the image and text redactors. All of it is pure functions with `bun test` unit tests, and it runs on a CPU-only laptop.

### Key Decisions

- **Pure functions behind contract interfaces.** No file system or HTTP code in `lib/detect/` or `lib/redact/`; the server passes bytes and text in. This makes each layer testable alone and keeps the folders conflict-free. Governs R1.
- **This stream owns merge and profile application.** These rules decide what the user sees, and they use the rule priority, so they sit next to the rules. Governs R15, R16.
- **This stream owns the demo fixtures.** Structure checks need special files (trailing data, EXIF, zero-width chars), and this stream knows how to make them. Governs R22.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan covers Stream 2 only.

- Depends on Stream 1 for types, interfaces, and the pipeline that calls these functions.
- Shares the OCR word type with Stream 3, which matches LLM quotes to OCR words.
- Can proceed independently of Stream 3 and Stream 4.

### Requirements

**Ground rules and spikes (hour 0-2)**

- R1. All code implements the interfaces in `lib/contract/` and takes bytes or text as input. It does no file or network I/O, except OCR language data loading.
- R2. Spike F3: tesseract.js runs in a Next.js Route Handler (Node runtime) with `langPath` set to `workspace/models/tesseract`, returns word boxes, and works with the network off. If it fails, try `serverExternalPackages`, then browser-side OCR (report to Stream 1, because it changes the contract).
- R3. Spike F4: sharp decodes an image, draws opaque rectangles, and encodes a new PNG/JPEG with no metadata and no trailing bytes. If it fails, report to Stream 1 and Stream 4 (fallback: browser canvas).

**Structure checks (M7)**

- R4. PNG trailing data: bytes after the `IEND` chunk produce a `hidden-data` finding with byte offset and size.
- R5. JPEG trailing data: bytes after the final `EOI` of the main image produce a `hidden-data` finding. Embedded thumbnails do not cause a false finding.
- R6. EXIF / XMP / IPTC metadata (GPS, device, author, software, timestamps) produces a `metadata` finding.
- R7. Zero-width characters (U+200B, U+200C, U+200D, U+2060, U+FEFF not at file start) in text and OCR text produce a `hidden-data` finding.
- R8. Instruction-like phrases produce a `prompt-injection` finding. The text is never followed.

**Rules (M5)**

- R9. Each rule has an id, category, title, reason, and positive and negative unit tests.
- R10. Secret rules cover the list in overview section 11 layer 2 (private keys, AWS, GitHub, Slack, Stripe, Google, OpenAI-style keys, JWTs, `password=`/`secret=`/`token=` assignments, connection strings with credentials, high-entropy `.env` values).
- R11. Internal-infra rules cover private IPv4 ranges and hostnames with `internal`, `staging`, `dev`, `corp`, `local`.
- R12. PII rules cover email, international phone, credit card (Luhn), and IBAN (checksum).

**Protected terms and OCR (M6)**

- R13. Protected terms, and the names of all saved recipients other than the package's recipient (category `other-client`), match case-insensitive, on word boundaries, in text and OCR text. A multi-word term matches a sequence of OCR words, and its box is the union of the word boxes. Each term has one shared `relatedGroupId`.
- R14. The OCR provider returns words with text, box, and confidence, and flags low-confidence images for coverage. Results are cacheable by the server.

**Profile, merge, package checks**

- R15. Profile application sets `suggestedAction` from the profile's allowed / needs-decision / remove lists and from the recipient's allow rules ("allowed for this recipient"). Rule findings in category `secret` are never auto-kept.
- R16. Merge joins findings with overlapping evidence and the same category into one finding with one detection per layer. Each detection keeps its method and evidence. Rule detections win for title and reason.
- R17. Find-related (exact) returns every exact match of a term in all text and OCR text, with evidence (M13).
- R18. The inconsistent-redaction check returns a warning for each related group or protected term where one occurrence is `redact` and another is `keep` or `open`, naming both files (M13).
- R19. The three profile presets use the default table in overview section 22, exported as seed data for Stream 1.

**Redaction (M15)**

- R20. Image redaction decodes to pixels, draws opaque filled rectangles with 2-4 px padding, and encodes a new file in the same format with no metadata. Output has no EXIF and no trailing data.
- R21. Text redaction replaces each approved span with `[REDACTED]`. In `.env` files it keeps the key and replaces only the value. It keeps line endings and UTF-8 encoding.

**Fixtures**

- R22. `scripts/make-fixtures.ts` creates `fixtures/demo-package/` (the 6 files of overview section 3, all fictional) and one fixture per structure check. The demo package is on `main` by hour 4.

### Acceptance Examples

- AE1. **Covers R15.**
  - **Given:** profile "Client" allows `internal-infra`, and the package's recipient has an allow rule for the text `acme.dev`.
  - **When:** a rule finds an AWS key and an internal hostname `acme.dev`.
  - **Then:** the AWS key has at least `needs-decision` (secret is never auto-kept), and the hostname has `keep` with "allowed for this recipient".
- AE2. **Covers R16.**
  - **Given:** a rule and an LLM both report the same email span as `personal-contact`.
  - **When:** findings merge.
  - **Then:** there is one finding with two detections (`rule` and `llm-text`), and the title and reason come from the rule.
- AE3. **Covers R18.**
  - **Given:** "Juniper" is `redact` in `notes.md` and `open` in `screenshot-01.png`.
  - **When:** the check runs.
  - **Then:** one warning names "Juniper", `notes.md`, and `screenshot-01.png`.
- AE4. **Covers R20.**
  - **Given:** `screenshot-02.png` with trailing data and EXIF.
  - **When:** it is redacted with no boxes.
  - **Then:** the output has no trailing bytes and no metadata.

### Success Criteria

- `bun test` passes for every rule, structure check, profile case, merge case, inconsistent case, and redactor case listed in overview section 19.
- All layers work with the network off.

### Scope Boundaries

- No LLM calls (Stream 3). No routes or storage (Stream 1). No UI (Stream 4).
- Region packs for national IDs (S4) are stretch.
- No blur or pixelation. Solid fill only.

### Dependencies / Assumptions

- tesseract.js quality on screenshots is enough (spike F3). If not, test PaddleOCR behind the same OCR interface.
- gitleaks / secretlint patterns are ported only with a compatible license.

### Outstanding Questions

**Deferred to Planning**

- Image upscale factor before OCR for small text.
- High-entropy threshold for `.env` values.
