# AI layer

`aiLayer` implements Contract v1's `AiLayer`. It accepts effective settings from
the server, uses only `/models` and `/chat/completions`, and has no file I/O.
The client uses native fetch rather than adding an SDK. Zod validates every
completion, including one repair attempt. Servers explicitly rejecting
`response_format` fall back to JSON-only prompts with the same validation gate.

Text chunks contain 200 lines with 10 lines of overlap, at most 30 findings each.
Text above 200 KiB of UTF-8 bytes is skipped. Vision input is resized inside
1600×1600 without enlargement; evidence uses the original OCR coordinates.
Text findings with no source match are dropped. Visual findings with no matching
OCR quote require a manually drawn box (`image-whole` evidence).

All HTTP calls share one serial queue. Connection probes use at most 15 seconds
per request (remote endpoints such as OpenRouter often take more than 3 s); analysis uses `timeoutMs` from settings. The deadline includes queue
wait and response-body parsing; expired queued requests never reach the server.
Transport failures throw
sanitized errors so the existing pipeline falls back to rules-only. Two invalid
JSON responses mark analysis failed while retaining valid findings from other
chunks. No file text, quotes, credentials or server error bodies are logged.

The process-local cache stores validated model output, never findings bound to a
file ID. Its key includes content SHA-256, model, prompt version, endpoint and a
fingerprint of credentials and prompt context. It holds at most 128 entries.
Restarting the server clears it. `readAiMetrics()` exposes count-only request and
JSON failure diagnostics for evaluation.
Malformed endpoint settings produce a failed connection test and rules-only
mode, with conservative remote locality.

## Integration by Stream 1

The team split reserves `lib/server/layers.ts` for Stream 1. In that file, the
contract owner can import `aiLayer` from `@/lib/ai` and replace `ai: stubLayers.ai`
with `ai: aiLayer`. The production routes still use the stub until that change
lands. Tests and the evaluation runner inject the real AI layer directly into
the existing pipeline.

Set `LLM_PROVIDER=mock` for network-free demo behavior. It returns fixed fictional
phrases through the same quote-matching gate. No model installation is needed.
For a model server, set `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`,
`LLM_TEXT_MODEL`, and optionally `LLM_VISION_MODEL` and `LLM_API_KEY`. Saved server
settings take precedence over environment values. The model tags must match
the IDs returned by that server's `/models` endpoint; this change does not assume
a particular tag is installed.

## Evaluation and pending GPU checks

Run `bun scripts/eval.ts --provider mock --mode all` for the fictional 13-file
fixture set. Add `--json` for a machine-readable report. It runs `analyzeFiles`
with the configured deterministic layers and the real AI module. Deterministic
layers are currently stubs: their scores are diagnostic, not a detector quality
claim. Fixed fixture OCR words isolate AI evaluation from Stream 2's OCR work.
The mock's perfect fixture scores confirm plumbing, not model accuracy.

For a real server, run:

```sh
bun scripts/eval.ts --provider openai-compatible --mode full \
  --base-url http://GPU-PC-ADDRESS:11434/v1 \
  --text-model ACTUAL-TEXT-MODEL-ID --vision-model ACTUAL-VISION-MODEL-ID
```

Use `--mode text-ai` to test text without vision, or `--mode all` for all modes.
Repeat for each model pair and for both LAN and Tailscale addresses. The runner
prints precision/recall per layer, dropped quotes, JSON failures, mode fallback,
and time/JSON failures per file. It exits unsuccessfully if the requested mode
cannot run or a file's AI analysis fails. Image-whole evidence counts as an
unlocalized prediction, not a correct labelled region. Labelled boxes require
intersection-over-union of at least 0.5, even if their quote matches. Text labels
use exact source quotes: a different quote boundary or added punctuation can
count as a miss. These are exact-evidence fixture scores, not a semantic accuracy
estimate. In JSON mode, count-only pipeline diagnostics go to stderr.

F1 (Gemma image JSON and screenshot latency), F2 (schema support on the actual
server), F6 (teammate LAN/Tailscale connectivity), R4 (team model selection), and
R20 (demo-model parity) remain unverified: no GPU model server was available in
this run. The fake-server tests verify protocol behavior only. Run the real
evaluation before choosing a demo model or claiming integration readiness. If
F1 fails, the plan calls for Qwen3 text plus OCR-only images; if F2 fails, this
client already supports JSON-only prompts and one repair retry.

## Verification on 2026-10-09

The complete suite passed on Bun 1.3.14: 100 tests and 317 assertions. Lint,
TypeScript and scoped formatting checks passed. `next build --webpack` passed
production compilation, type checking and page generation. The default
Turbopack build remains unverified because its CSS worker could not bind a port
in this execution environment.

An existing development cloud configuration passed the connection test and ran
all 13 fictional fixtures in Full mode with `google/gemma-4-26b-a4b-it` for text
and vision. The final run had zero JSON failures, zero failed files and two
dropped quotes; total file processing took 32.7 seconds (slowest file 6.6 seconds).
Exact-evidence text precision/recall were 0.286/0.333; localized vision
precision/recall were 1.0/0.5. This larger cloud model is not the planned Gemma
4 E4B demo-model parity check. The mock passed all three modes with perfect
fixture precision/recall; that verifies the pipeline plumbing only.

The `ce-code-review` run `20261009-183310-6b24b813` reviewed the pre-fix snapshot
with eight personas and independently validated five findings. All five were
applied locally: valid probe PNG (#1), box-first image scoring (#2), clean JSON
stdout on transport fallback (#3), deadlines covering queue wait (#4), and
precision assertions covering negative fixtures (#5). Targeted regressions
reproduced the four runtime bugs before their fixes, then passed; the complete
suite passed afterward. Additional tests cover malformed endpoints and retention
of earlier findings when a later chunk fails JSON validation. No review finding
remains unapplied. GPU/LAN checks, demo-model choice and parity (including the
hostile instructions in `injection.md`), and Stream 1's production wiring remain
pending.

Implementation references: [Zod JSON Schema](https://zod.dev/json-schema),
[sharp resizing](https://sharp.pixelplumbing.com/api-resize/), and the
[Chat Completions protocol](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
