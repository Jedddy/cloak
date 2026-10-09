---
title: AI Layer - Plan
type: feat
date: 2026-10-09
topic: ai-layer
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# AI Layer - Plan

## Goal Capsule

- **Objective:** Cloak finds context leaks (other clients, codenames, pricing, unreleased work) in text and screenshots with a local model, every AI finding points to exact evidence, and the app falls back cleanly when no model is reachable.
- **Owner:** Teammate C (Stream 3), on the GPU PC or on its LAN.
- **Product authority:** `sentineldesk-overview.md` sections 11 (layers 5-6), 12, 13 (AI related suggestions), 18, 19 (evaluation). Interfaces come from `lib/contract/` (Stream 1). Coordination rules are in `docs/plans/2026-10-09-1558-docs-team-split-plan.md`.
- **Open blockers:** Contract v1 (hour 2). Before that, run spikes F1, F2, and F6.

---

## Product Contract

### Summary

Stream 3 builds everything that talks to a model: the OpenAI-compatible client, connection test, locality classification, mode resolution, text and vision analysis with quote matching, AI "find related" suggestions, the result cache, and the mock provider. It also builds the evaluation fixtures and script used for the daily parity check.

### Key Decisions

- **The LLM can only add findings.** The AI layer returns candidate findings with evidence. It never removes or downgrades a finding and never marks a file safe. Governs R10, R11.
- **Quote matching lives in this stream.** It is the anti-hallucination gate, and it needs the prompt contract and the OCR word type together. Governs R11.
- **The GPU PC owner owns this stream.** Prompt work must be tested on the demo model (Gemma 4 E4B), not only on a larger cloud model. Governs R5, R20.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan covers Stream 3 only.

- Depends on Stream 1 for types, interfaces, the settings store, and the pipeline that calls these functions.
- Shares the OCR word type with Stream 2.
- Can proceed independently of Stream 4 (the UI uses the connection-test result through Stream 1 routes).

### Requirements

**Spikes (hour 0-2)**

- R1. Spike F1: Gemma 4 E4B via Ollama or LM Studio answers one `/chat/completions` request with an image and JSON in under ~20 s. If it fails, use Qwen3 4B for text and OCR-only for images (Text AI as demo mode), and tell the team.
- R2. Spike F2: `response_format` with a JSON schema works on the demo server. If it fails, use "JSON only" prompts, zod, and one repair retry.
- R3. Spike F6: a teammate laptop reaches the GPU PC model over the LAN and over Tailscale. If it fails, teammates use cloud option B or mock.
- R4. The spike results decide the demo model (overview open decision 5). Post the result to the team by hour 2.

**Connection, locality, mode (M1, M17)**

- R5. One OpenAI-compatible client is built on the server from settings and env (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_TEXT_MODEL`, `LLM_VISION_MODEL`, `LLM_PROVIDER`). It uses only `GET /models` and `POST /chat/completions`.
- R6. Connection test returns the model list, a JSON test result, latency, locality, and the mode the app will use.
- R7. Locality classification follows overview section 12: localhost / 127.0.0.0/8 / ::1 → local; 10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7, `*.local` → lan; else remote; mock provider → mock. Unit tests cover each range.
- R8. Mode resolution checks reachability with a short timeout: text and vision reachable → full; only text → text-ai; nothing → rules-only.

**Analysis (M8, M9)**

- R9. Text analysis follows the prompt contract in overview section 12: delimited inputs, content is data, JSON output with category, quote, reason, confidence. Long text is chunked by lines with overlap. Text over 200 KB returns `skipped-too-large`.
- R10. Vision analysis sends the image (downscaled if large), OCR text, recipient name, profile, and protected terms, and returns findings with `regionType` and an optional quote. It runs in Full mode only.
- R11. Quote matching: exact search, then normalized whitespace and case, then OCR word sequence (box = union of word boxes, one box per line). No match → drop the finding and count it in `llmQuotesDropped`. Several matches → one finding with several evidence entries. Vision findings with no matching quote get `image-whole` evidence.
- R12. Each response is validated with zod. On failure, one repair retry. On a second failure, the chunk is marked failed for coverage.
- R13. Temperature is low (0-0.2). Requests use the timeout from settings. AI calls run with concurrency 1.
- R14. Results are cached by `sha256(content) + model + promptVersion`.

**Related suggestions (M13)**

- R15. In Full and Text AI mode, AI find-related asks for possible references to a term (abbreviations, nicknames, descriptions) in the other files. Results use the same quote matching (R11) and are marked "possible related (AI suggestion)".

**Mock provider (M18)**

- R16. `LLM_PROVIDER=mock` returns fixed findings for the demo package files, with locality `mock`, and needs no network. It is on `main` by hour 4, so Streams 1, 2, and 4 can run the full flow.

**Evaluation and logging**

- R17. `fixtures/eval/` holds 10-20 fictional files with a `labels.json` (file, category, quote or box).
- R18. `scripts/eval.ts` runs the pipeline per mode and model and prints precision and recall per layer, dropped quotes, JSON failures, and time per file.
- R19. Logs from this stream contain ids and counts only, never file content or quotes.
- R20. Before each integration checkpoint, run the eval on the demo model (parity check).

### Acceptance Examples

- AE1. **Covers R11.**
  - **Given:** the model returns the quote "Project  juniper" (double space, lower case), and the source has "Project Juniper".
  - **When:** quote matching runs.
  - **Then:** the normalized search matches, and the finding has the exact source span.
- AE2. **Covers R11.**
  - **Given:** the model returns a quote that is not in the source.
  - **When:** quote matching runs.
  - **Then:** the finding is dropped and `llmQuotesDropped` increases by 1.
- AE3. **Covers R8.**
  - **Given:** a text model is set and reachable, and the vision model is not set.
  - **When:** mode resolution runs.
  - **Then:** the mode is `text-ai`.
- AE4. **Covers R7.**
  - **Given:** base URL `http://100.101.1.5:11434/v1`.
  - **When:** locality is classified.
  - **Then:** the result is `lan`.

### Success Criteria

- Unit tests pass for locality, mode resolution, quote matching (exact, normalized, OCR sequence, multi-line, no match), and zod repair.
- On the demo package, the model finds "Project Juniper", internal pricing in `notes.md`, and the other client name in the `screenshot-01.png` tab bar.

### Scope Boundaries

- No rule, OCR, or redaction logic (Stream 2). No routes or storage (Stream 1). No UI (Stream 4).
- Combined reveal (S2) and the evaluation page (S1) are stretch.
- No model training or fine-tuning.

### Dependencies / Assumptions

- The GPU PC runs Ollama or LM Studio with the demo model. Exact model tags are verified during spike F1.
- Cloud endpoints are used in development only, with fictional files only.

### Outstanding Questions

**Deferred to Planning**

- `openai` client package or AI SDK with `@ai-sdk/openai-compatible`.
- Maximum findings per chunk and the chunk size inside the 150-250 line range.
