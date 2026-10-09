<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Rules

- Always use `shadcn` components if applicable. If a component is not installed
  yet, **install** it and do not recreate from scratch.
- If a function you create will only be used once, consider whether it should be
  a function at all. If it is only used in one place, it may be better to inline
  the code instead of creating a new function.
- When updating code, IF a function can be used in a generic way, try to look
  for a generic function that can be used instead of writing a new one. If no
  generic function exists, create one in lib/utils.
- Avoid excessive use of ternary operators. If a ternary operator is used, it
  should be simple and easy to read. If it becomes too complex, consider using
  an if statement instead.

# React Effects

Use `useEffect` only to sync with an external system (network, DOM, browser API,
non-React widget).

- Derived values: calculate them during render. Do not store them in state. Use
  `useMemo` only when the calculation is slow.
- Reset state on a prop change: use `key`. Store IDs, not objects, and derive
  the object during render.
- Logic that a user action causes (POST, notification, `onChange` to the
  parent): put it in the event handler, not in an Effect.
- Do not chain Effects that set state. Calculate the next state in the handler.
- Fetch in the parent and pass the data down. Do not send data up through an
  Effect.
- External stores: use `useSyncExternalStore`.
- Fetch in an Effect only with cleanup that ignores stale responses. Prefer the
  data library.
- One-time app init: use a module-level guard, not `useEffect(..., [])`.
- This repository uses oxlint and oxfmt instead of eslint and prettier.

# Design Context

- Register is `product`. Read `PRODUCT.md` and `DESIGN.md` before any UI work.
- DESIGN.md is a seed. Re-run `/impeccable document` once real UI lands to capture tokens.
