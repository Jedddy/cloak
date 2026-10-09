---
title: Cloak Team Split - Plan
type: docs
date: 2026-10-09
topic: team-split
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
---

# Cloak Team Split - Plan

## Goal Capsule

- **Objective:** Four people build the full Cloak MVP (M1-M18 in `sentineldesk-overview.md`) in 24 hours, and each person works in their own folders with few merge conflicts and no waiting after hour 2.
- **Product authority:** `sentineldesk-overview.md` is the source for all product behavior. This plan only sets ownership, timeline, and merge rules. The four stream plans hold the work.
- **Open blockers:** Contract v1 must be on `main` before the other streams merge real code (R5).

---

## Product Contract

### Summary

The team splits the work by layer into four streams. Each stream has one owner, its own folders, and its own plan file. The contract stream publishes the shared types, the HTTP API, and the internal module interfaces first, so the other three streams can build against stubs and fixtures from hour 1.

### Problem Frame

The overview describes one app with 18 MVP items, 6 feasibility spikes, and many cross-layer links (OCR words feed rules, AI, and redaction; findings feed review, export, and verification). If four people edit the same files, they lose time to merge conflicts and to waiting for each other. The build window is 24 hours, so there is no time for a long integration phase at the end.

### Key Decisions

- **Split by layer, not by vertical feature.** Each person owns a set of folders. A vertical split puts all four people in the same types, store, and route files. (session-settled: user-approved — chosen over a vertical-slice split and a hybrid split: a layer split gives the fewest shared files.) Governs R1, R2.
- **Full MVP, no tiers.** All of M1-M18 stay in scope. (session-settled: user-directed — chosen over a Tier A / Tier B cut and a demo-script-only cut: the team wants the full MVP.) Governs R11, R13.
- **Contract covers HTTP and internal interfaces.** The contract owner defines the module interfaces between Detect, AI, and the server, not only the HTTP routes. Without this, Detect and AI cannot build in parallel. Governs R4, R5.
- **Route Handlers only, and polling for job progress.** One HTTP surface lets the UI build against stub routes, and polling is simpler to stub than a stream. This closes overview open decisions 1 and 2. Governs R4.
- **Overview defaults close the other open decisions.** Placeholder is `[REDACTED]`. The review report stays local and is not in the zip. The three suggested profile presets are used. Spike F1 decides the demo model.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan covers coordination only. The four streams below are the current split; a stream owner may move a small item to another stream if both owners agree and they update both plans.

- **Stream 1 — Contract and server spine** (owner: Jed). `docs/plans/2026-10-09-1558-feat-contract-and-server-spine-plan.md`
  - Enables all other streams (contract v1 at hour 2).
  - Depends on Detect and AI for real pipeline steps; uses stubs until they merge.
- **Stream 2 — Deterministic detection and redaction** (owner: teammate B). `docs/plans/2026-10-09-1558-feat-detection-and-redaction-plan.md`
  - Depends on the contract types and module interfaces.
  - Can proceed independently of AI and UI.
- **Stream 3 — AI layer** (owner: teammate C, the GPU PC owner or a teammate on its LAN). `docs/plans/2026-10-09-1558-feat-ai-layer-plan.md`
  - Depends on the contract types and module interfaces.
  - Shares the OCR word type with Detect (defined in the contract).
- **Stream 4 — UI** (owner: teammate D). `docs/plans/2026-10-09-1558-feat-ui-plan.md`
  - Depends on the contract HTTP API and the fixture data.
  - Can proceed independently of Detect and AI.

### Requirements

**Ownership**

- R1. Each stream owns the folders in the ownership table below. A person does not edit a folder that another stream owns. To get a change, the person asks the owner.
- R2. Shared root files have one owner. `package.json`, `bun.lock`, `next.config.ts`, `.gitignore`, `.oxlintrc.json`, and `tsconfig.json` belong to Stream 1. `components.json`, `app/layout.tsx`, and `app/globals.css` belong to Stream 4.
- R3. A person who needs a new dependency asks the Stream 1 owner, or adds it in a separate commit that contains only `package.json` and `bun.lock`, and merges that commit at once.

| Folder or file | Owner |
|---|---|
| `lib/contract/` (types, zod schemas, API route table, module interfaces, fixture objects) | Stream 1 |
| `lib/server/` (workspace store, job runner, pipeline orchestration, export, verification) | Stream 1 |
| `app/api/**` | Stream 1 |
| Shared root config files (R2) | Stream 1 |
| `lib/detect/`, `lib/redact/` | Stream 2 |
| `fixtures/demo-package/`, `scripts/make-fixtures.ts`, OCR language data setup | Stream 2 |
| `lib/ai/` | Stream 3 |
| `fixtures/eval/`, `scripts/eval.ts` | Stream 3 |
| `app/(app)/**` pages, `components/**`, `lib/client/` | Stream 4 |
| `components.json`, `app/layout.tsx`, `app/globals.css`, `lib/utils.ts` | Stream 4 |

**Contract process**

- R4. Stream 1 publishes contract v1 as defined in the Stream 1 plan (its R1-R5): shared types, schemas, routes, module interfaces, and fixtures.
- R5. Contract v1 is on `main` by hour 2. Before that, other streams do spikes and setup only.
- R6. After v1, only the Stream 1 owner edits `lib/contract/`. Other owners request changes in the team chat. Stream 1 merges each change as one small commit and announces it.
- R7. Additive contract changes (a new optional field, a new type) can merge at any time. A breaking change (rename, remove, type change) needs a short agreement from the affected owners first.

**Git and merge**

- R8. Each stream works on its own branch (`stream/contract`, `stream/detect`, `stream/ai`, `stream/ui`). Each owner rebases on `main` and merges to `main` at least every 3 hours, and at each integration checkpoint.
- R9. `main` must build and pass `bun test` and `bun run lint` after each merge. The person who breaks `main` fixes it first.
- R10. Generic helpers go in `lib/utils.ts` (AGENTS.md rule). Changes to that file are append-only and go in small separate commits.

**Timeline**

- R11. The team targets all of M1-M18. Each stream plan lists its MVP items and acceptance checks.
- R12. The team follows these checkpoints:

| Hour | Checkpoint |
|---|---|
| 0-2 | Stream 1 writes contract v1. Stream 2 runs spikes F3, F4 and makes demo fixtures. Stream 3 runs spikes F1, F2, F6. Stream 4 runs shadcn init and builds the app shell. |
| 2 | Contract v1 on `main` (R5). |
| 3 | Stream 1 stub routes on `main`: every route returns fixture data. Stream 4 builds against them. |
| 12 | Integration 1: real upload, scan in Rules-only mode, review, export, and verification work end to end on the demo package. |
| 16 | Integration 2: Full mode on the LAN model works end to end. If behind, use the priority order in R13. |
| 20 | Feature freeze. Bug fixes only. |
| 22 | Two full demo rehearsals with the network off (overview section 23). |

- R13. If the team is behind at hour 16, finish items in this order. This does not remove scope; it only sets what is finished first: M2, M4, M5, M7, M6, M10, M11, M15, M16, M17, M18, M8, M1, M13, M9, M12, M3 (editing), M14.

### Acceptance Examples

- AE1. **Covers R6, R7.**
  - **Given:** Stream 3 needs a new optional `confidence` field on `Finding`.
  - **When:** the Stream 3 owner asks in the team chat.
  - **Then:** Stream 1 adds the field in one commit, merges it, and announces it. No other owner must agree, because the change is additive.
- AE2. **Covers R1, R3.**
  - **Given:** Stream 2 needs `tesseract.js` and a `serverExternalPackages` entry.
  - **When:** the Stream 2 owner adds the dependency in a commit with only `package.json` and `bun.lock`, and asks Stream 1 to edit `next.config.ts`.
  - **Then:** no other files in Stream 1 folders change in the Stream 2 branch.

### Success Criteria

- At hour 12 the demo package goes through upload, scan, review, export, and verification in Rules-only mode.
- At hour 22 the 10-step demo script runs with the network off.
- No merge conflict takes more than 15 minutes to resolve.

### Scope Boundaries

- Product scope is not changed by this plan. The "out of scope" list in overview section 6 applies to all streams.
- Stretch items S1-S8 start only after Integration 2 passes and the stream owner has no open MVP item.

### Dependencies / Assumptions

- The team has one GPU PC (RTX 3060, 6 GB). Stream 3 works on it or connects to it over the LAN or Tailscale. Streams 1, 2, and 4 use `LLM_PROVIDER=mock`.
- The team uses one chat channel for contract change requests and merge announcements.

### Outstanding Questions

**Deferred to Planning**

- Which teammate owns Streams 2, 3, and 4. Stream 3 goes to the person on the GPU PC.

### Sources / Research

- `sentineldesk-overview.md` — product source (sections 6, 8, 10, 20, 22, 23).
- `AGENTS.md` — repository rules (shadcn, `lib/utils`, Effects, oxlint/oxfmt).
