# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Freelancers and small agencies (designers, developers, consultants) preparing an outbound handoff. They have no IT admin and no enterprise DLP. They share via Drive links, WeTransfer, email, chat.

Their context: a folder is assembled for one specific recipient. They open SentinelDesk asking "what am I sharing by accident?" The job is to see what the package reveals to that recipient, decide per finding, and leave confident to send.

Secondary users (support teams, researchers) are out of scope for the hackathon.

## Product Purpose

SentinelDesk is a private review desk for outgoing files. The user assembles a sharing package for one recipient, sees what it reveals to that recipient, and creates reviewed copies before sending. Everything runs on the user's machine.

Success is a calm export: reviewed copies rebuilt with approved redactions, verification reporting "Reviewed. No open detected findings," with honest coverage of what was and was not analyzed. The demo proves local AI remains useful with the network off.

## Positioning

Recipient-aware review of a full sharing package. Existing local tools (closest: Philter Desktop) redact PII from one document at a time. SentinelDesk checks a whole handoff package (screenshots, notes, config files) for what it reveals to one specific recipient: other clients, codenames, internal pricing, secrets, and PII. A recipient profile sets the suggested action. A local LLM and a vision model add context findings with exact-quote evidence. Package checks find related occurrences and inconsistent redactions across files. Export rebuilds the files and verification scans the reviewed copies again.

SentinelDesk does not compete on PDF or Office PII redaction; other tools support more document formats.

## Operating Context

- **Use:** the user assembles one package for one recipient, scans it, reviews each finding, previews, exports a zip of reviewed copies, and sends it through their usual channel. SentinelDesk does not send anything.
- **Environment:** a local server and a browser on the user's PC (`http://127.0.0.1:3000`). The model is any OpenAI-compatible server on the machine or the LAN (for example Ollama or LM Studio).
- **Evaluation:** AppBuildersPH Hackathon 2026, theme "Local AI". Judges are expected to turn off the network, check that local AI is the core of the product, and check that the reason for "local" is clear in one sentence. The demo runs on a local or LAN endpoint only, with a 3–4 minute script (overview section 23).
- **Terminology:** `CONTEXT.md` is the glossary (package, recipient, recipient profile, finding, evidence, decision, reviewed copy, verification, coverage, mode, locality). Use its terms and avoid the terms it lists as "Avoid".

## Capabilities and Constraints

- **Inputs:** PNG, JPEG, and text files (`.txt`, `.md`, `.json`, `.csv`, `.env`, `.log`, `.yaml`). Other types are listed as "not supported" in coverage, never skipped silently. Flat file list only.
- **Detection layers:** rules (secrets, PII, protected terms), offline OCR with word boxes, structure checks (metadata, trailing data after PNG `IEND` / JPEG `EOI`, zero-width characters, instruction-like text), LLM text analysis with quote matching, and vision analysis of screenshot UI regions. Manual boxes on images.
- **Modes:** Full, Text AI, Rules only, chosen by what is reachable. If the model stops, the scan switches to Rules only and the UI shows it.
- **Locality:** Local, LAN, Remote, or Mock. A remote endpoint needs the user's confirmation per package.
- **Decisions:** redact, keep, keep and remember (allow rule on the recipient), not an issue (one package only, never remembered), and exclude file. A secret never becomes an allow rule.
- **Export:** originals stay read-only. Export rebuilds images from decoded pixels and writes text files new, applies solid-fill redactions, strips metadata, then verifies.
- **Network:** the built app makes no network calls except to `127.0.0.1` and the configured model server. It loads no remote fonts or scripts at runtime.
- **Out of scope:** PDF redaction, Office files, archives, email files, recursive folder import, desktop shells, accounts, cloud sync, telemetry, mobile apps, model training.
- **Undecided:** the final demo model (Gemma 4 E4B for text and vision, or Qwen3 4B for text with OCR only) depends on spike F1.

## Brand Commitments

**Name:** SentinelDesk.

**Personality:** Calm, exact, discreet. A quiet desk tool, not an alarm panel. Voice is precise and restrained: states what was found, where, and why it matters for this recipient. No fear, no hype, no marketing fluff. Reference feel: a system utility like a file manager or disk utility — invisible craft that gets out of the way and lets evidence speak.

**Wording:** the only success copy is "Reviewed. No open detected findings." The product never says "safe", "clean", or "contains no sensitive information".

**Anti-references:** Not a SaaS marketing dashboard. Avoid gradient hero-metrics, identical icon-card grids, tiny uppercase kickers on every section, numbered section markers, neon dark ops-decor, and decorative motion. Avoid scary-security tropes (red-alarm panels, hacker-terminal green) and playful consumer styling (rounded bubbly controls, emoji, casual copy). Density and consistency beat decoration.

## Evidence on Hand

- **Demo package (planned, not in the repo yet):** `fixtures/demo-package/`, the six files of the main scenario in `sentineldesk-overview.md` section 3. All data in it is fictional.
- **Contract fixtures:** `lib/contract/fixtures.ts` (fixed API data for UI work and tests).
- **Absent, do not invent:** testimonials, users or customers, usage metrics, detection accuracy numbers, benchmarks, pricing, and licensing terms.

## Product Principles

1. **Evidence or nothing.** Every finding points to an exact location — a text span, an image region, or a byte offset. A quote that cannot be found in the source is dropped.
2. **Human decides, machine proposes.** The app suggests actions from the recipient profile; only the user keeps, redacts, remembers, or marks a finding as not an issue. The model can only add findings, never clear them.
3. **Honest coverage over false comfort.** A file not processed, or processed without AI, never looks clean. No scores, no "safe" language.
4. **Local by default, and visible.** File reading, OCR, rules, AI, redaction, and export run on the machine or LAN. The UI always shows where the model runs. Rules-only mode is a complete, useful product.
5. **Rebuild, never edit.** Originals are never modified. Export writes new files from decoded pixels or approved text, with solid fills only (no blur, no pixelation). File content is untrusted data, never an instruction to the app or the model.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Body text contrast minimum 4.5:1. Full keyboard review flow (next/previous finding, redact, keep), visible focus states, and logical three-column reading order on the Review screen. Respect `prefers-reduced-motion` with instant or crossfade alternatives; product transitions stay in the 150–250 ms range and convey state only. Image-region findings always carry a text equivalent (category, reason, quote where applicable).
