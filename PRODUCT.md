# Product

## Register

product

## Users

Freelancers and small agencies (designers, developers, consultants) preparing an outbound handoff. They have no IT admin and no enterprise DLP. They share via Drive links, WeTransfer, email, chat.

Their context: a folder is assembled for one specific recipient. They open SentinelDesk asking "what am I sharing by accident?" The job is to see what the package reveals to that recipient, decide per finding, and leave confident to send.

Secondary users (support teams, researchers) are out of scope for the hackathon.

## Product Purpose

SentinelDesk is a private review desk for outgoing files. The user assembles a sharing package for one recipient, sees what it reveals to that recipient, and creates reviewed copies before sending. Everything runs on the user's machine.

Success is a calm export: reviewed copies rebuilt with approved redactions, verification reporting "Reviewed. No open detected findings," with honest coverage of what was and was not analyzed. The demo proves local AI remains useful with the network off.

## Brand Personality

Calm, exact, discreet. A quiet desk tool, not an alarm panel. Voice is precise and restrained: states what was found, where, and why it matters for this recipient. No fear, no hype, no marketing fluff. Reference feel: a system utility like a file manager or disk utility — invisible craft that gets out of the way and lets evidence speak.

## Anti-references

Not a SaaS marketing dashboard. Avoid gradient hero-metrics, identical icon-card grids, tiny uppercase kickers on every section, numbered section markers, neon dark ops-decor, and decorative motion. Avoid scary-security tropes (red-alarm panels, hacker-terminal green) and playful consumer styling (rounded bubbly controls, emoji, casual copy). Density and consistency beat decoration.

## Design Principles

1. **Evidence or nothing.** Every finding points to an exact location — a text span, an image region, or a byte offset. A quote that cannot be found in the source is dropped.
2. **Human decides, machine proposes.** The app suggests actions from the recipient profile; only the user keeps, redacts, remembers, or dismisses. The model can only add findings, never clear them.
3. **Honest coverage over false comfort.** A file not processed, or processed without AI, never looks clean. No scores, no "safe" language — only "Reviewed. No open detected findings."
4. **Local by default, and visible.** File reading, OCR, rules, AI, redaction, and export run on the machine or LAN. The UI always shows where the model runs.
5. **Calm discretion.** Quiet surfaces, exact wording, solid redaction fills. The tool disappears into the review task so the user can send with confidence.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Body text contrast minimum 4.5:1. Full keyboard review flow (next/previous finding, redact, keep), visible focus states, and logical three-column reading order on the Review screen. Respect `prefers-reduced-motion` with instant or crossfade alternatives; product transitions stay in the 150–250 ms range and convey state only. Image-region findings always carry a text equivalent (category, reason, quote where applicable).
