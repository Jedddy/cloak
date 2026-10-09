# Cloak

A private review desk for outgoing files. You assemble a **package** of files for one **recipient**, see what it reveals to that recipient, and export **reviewed copies** before you send them. Everything runs on your machine.

## Who it is for

Freelancers and small agencies — designers, developers, consultants — preparing a handoff for a client. People who share through Drive links, WeTransfer, email, or chat, and have no IT admin or enterprise data-loss tooling behind them.

## The problem it solves

A handoff folder is put together for one client, but it often carries things meant for nobody outside your desk:

- another client's name in a screenshot, a notes file, or a slide
- internal pricing and margins in a spreadsheet, sometimes on a hidden sheet
- API keys and tokens in a `.env` file or a terminal screenshot
- tracked changes and comments with author names in a proposal
- metadata, hidden text, or the cropped-out part of a screenshot still inside the file

Most redaction tools look at one document at a time and only for generic PII. Cloak reviews the **whole package for one specific recipient**: what is fine to send to this client can be a leak to another. And it removes approved content from the file itself, not just from what is visible, then checks the result again.

## What it does

1. **Create a package** for a recipient. The recipient's **profile** decides which categories are allowed, need a decision, or should be removed. Add **protected terms** (codenames, client names) for the package.
2. **Add files**: PNG and JPEG screenshots, text files (`.txt`, `.md`, `.json`, `.csv`, `.env`, `.log`, `.yaml`), and documents (`.pdf`, `.docx`, `.xlsx`, `.pptx`).
3. **Scan.** Every file goes through the same detection layers:
   - rules for secrets, PII, and protected terms
   - offline OCR with word boxes for images, embedded images, and scanned PDF pages
   - structure checks: metadata, trailing data after an image ends, zero-width characters, instruction-like text, and hidden document content (comments, tracked changes, hidden sheets, rows, and slides, annotations, attachments, external links)
   - a local LLM for context findings and a vision model for screenshot regions, both with exact-quote evidence
4. **Review** each **finding** with its evidence: redact, keep, keep and remember (an allow rule for this recipient), or not an issue. Draw boxes on images and PDF pages, or select text in Office documents, to add your own findings. Package checks find related occurrences and warn when a term is redacted in one file but visible in another.
5. **Export.** Originals are never changed. Cloak rebuilds each file: images from decoded pixels, text files fresh, and documents in their own format with the redacted content removed from the file (not just covered). Metadata is stripped. If a PDF page's redaction cannot be verified, only that page is flattened to an image, and coverage says so.
6. **Verify.** Cloak scans the reviewed copies again and searches them for any text that should be gone. When nothing is open, it reports **"Reviewed. No open detected findings."** Coverage lists every file that was not processed, not supported, or analysed without AI, so nothing looks reviewed when it was not.

Cloak never sends anything. You download a zip of the reviewed copies and share it through your usual channel.

## Local by design

File reading, OCR, rules, AI, redaction, and export run on your machine or LAN. The built app makes no network calls except to `127.0.0.1` and the model server you configure, and loads no remote fonts or scripts. The model is any OpenAI-compatible server, for example [Ollama](https://ollama.com) or LM Studio. The UI always shows where the model runs; a remote endpoint needs your confirmation per package.

Without a model, Cloak runs in **Rules only** mode, which is still a complete review. **Text AI** adds a text model; **Full** adds a vision model. If the model stops during a scan, the rest of the scan continues rules-only and the UI says so.

## Getting started

Requirements: [Bun](https://bun.sh) 1.3 or later. Optional: a local OpenAI-compatible model server.

```bash
bun install
bun scripts/setup-ocr-data.ts   # one-time: English OCR data into workspace/models/tesseract
cp .env.example .env.local      # then edit the model settings
bun dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). For a production build, run `bun run build` then `bun run start` (it binds to `127.0.0.1`).

### Configuration

| Variable | Purpose | Default |
|---|---|---|
| `LLM_PROVIDER` | `openai-compatible`, or `mock` for a demo model with no server | `openai-compatible` |
| `LLM_BASE_URL` | Model server URL | `http://127.0.0.1:11434/v1` |
| `LLM_API_KEY` | API key, read from the environment only and never saved | none |
| `LLM_TEXT_MODEL` / `LLM_VISION_MODEL` | Model names for text and vision analysis | none (rules only) |
| `LLM_TIMEOUT_MS` | Model request timeout | `60000` |
| `SENTINEL_WORKSPACE_DIR` | Where packages, settings, and uploads are stored | `./workspace` |
| `SENTINEL_TESSERACT_MODEL_DIR` | OCR language data folder | `workspace/models/tesseract` |

Model settings can also be changed on the Settings page, which tests the connection and shows the mode and locality it resolves to.

### Docker

```bash
docker build -t cloak .
docker run -p 3000:3000 -v cloak-workspace:/app/workspace --env-file .env.local cloak
```

The image includes the OCR data. Mount a volume on `/app/workspace` to keep packages between runs.

## Development

```bash
bun test            # unit, integration, and acceptance tests
bunx tsc --noEmit   # type check
bun run lint        # oxlint
bun run build       # production build
```

- `lib/contract/` — schemas and layer interfaces shared by every part of the app
- `lib/detect/` — rules, OCR, structure checks, profiles, merging, package checks
- `lib/ai/` — model connection, mode resolution, text and vision analysis
- `lib/redact/` — image and text redaction
- `lib/document/` — PDF and Office extraction, native redaction, and the residue check
- `lib/server/` — workspace storage, scan pipeline, export, and verification
- `app/` and `components/` — the Next.js routes and UI

Product context lives in `PRODUCT.md`, terminology in `CONTEXT.md`, and plans in `docs/plans/`. Test fixtures are fictional and built by scripts in `scripts/`.

## Limits

- Legacy `.doc`, `.xls`, `.ppt`, ODF files, archives, and email files are not supported; encrypted and macro-enabled documents are listed as unsupported with the reason.
- Charts, SmartArt, and embedded objects in Office files are not analysed; coverage lists them.
- Detection can miss things. Cloak reports what it found and what it could not check — it does not certify that a file contains nothing sensitive.

## Third-party licenses

PDF parsing, rendering, and redaction use [MuPDF.js](https://mupdf.com/) (`mupdf`), which is licensed under the **AGPL-3.0**. Cloak runs on the user's own machine and its source is open, which meets the AGPL terms. Anyone who offers a modified Cloak as a network service must publish their changes under the AGPL too. Reviewed PDFs are checked again with [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`, Apache-2.0), and Office files are parsed with `jszip` (MIT/GPLv3) and `@xmldom/xmldom` (MIT).
