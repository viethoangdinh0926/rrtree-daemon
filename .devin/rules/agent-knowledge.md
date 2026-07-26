# Agent knowledge (OKF + CodeGraph)

OKF and CodeGraph are complementary — not mutually exclusive.

| Layer | Use for | Keep current |
|-------|---------|--------------|
| **OKF** (`okf/`) | Product intent, causality, API/ops, known issues | After business-logic changes **and** when drift check finds manual/out-of-band edits |
| **CodeGraph** (`.codegraph/`) | Symbols, callers, which files to open | Re-index when stale/missing **and** after every code-change session |

## Before consulting OKF or CodeGraph

Run a **drift check** first (users may have edited code without updating knowledge):

1. `git status --short` and recent `git log` on `src/`, `scripts/`, vs `okf/` / latest `okf/log.md`.
2. If product-relevant code changed without matching OKF updates → update those OKF concepts from current source, append `okf/log.md`, `npx okfgen validate okf`.
3. If `.codegraph/codegraph.db` is missing or source is newer / working tree has code edits → run `codegraph index` (if installed) **before** graph navigation.
4. Only then orient with OKF and navigate with CodeGraph.

Never treat a known-stale OKF page as authoritative over current code. Full detection steps: `AGENTS.md` at the repo root.

## After you change the codebase

1. Run `codegraph index` (skip only if not installed; note in wrap-up).
2. If business logic / API / ops / known issues changed: update `okf/**/*.md`, link from nearest index as `* [Title](path) - description`, append `okf/log.md`, validate.

Nested `okf/**/index.md` files must have no frontmatter. Only root `okf/index.md` may declare `okf_version`.
