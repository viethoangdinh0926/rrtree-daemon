# Agent instructions (Cursor, Devin, and others)

This repo keeps two complementary knowledge layers. They are **not** mutually exclusive — use both.

| Layer | Location | Answers | When to use |
|-------|----------|---------|-------------|
| **OKF** | [`okf/`](okf/index.md) | *Why / what / how* — product intent, causality rules, API contracts, ops playbooks, known issues | Orient before coding; keep in sync when behavior changes |
| **CodeGraph** | [`.codegraph/`](.codegraph/) | *Where / who calls whom* — symbols, callers, file paths, dependency edges | Narrow which source files to open; avoid blind repo-wide grep |

## Recommended workflow

1. **Drift check (first)** — before trusting OKF or CodeGraph, detect manual/user (or out-of-band) code changes that may have left knowledge stale; refresh as needed (see below).
2. **Orient with OKF** — start at [`okf/index.md`](okf/index.md). Read the architecture and component concepts that match the task.
3. **Navigate with CodeGraph** — `codegraph query "<symbol>"` / `codegraph trace <caller>` (or MCP `codegraph_explore`) to find exact files and call chains. Then open only those files.
4. **Implement** in source under `src/` (and related project files).
5. **Maintain OKF** when the change affects business logic, causality, API surface, ops, or known issues (see below).
6. **Update CodeGraph** after you change the codebase — run `codegraph index` before finishing the session.

`.codegraph/codegraph.db` is **local and gitignored**. On a new machine/clone, install and build it before relying on graph navigation (see README “Set up CodeGraph on a new machine”). OKF under `okf/` is committed and needs no per-machine generation.

Do **not** skip OKF and reverse-engineer product rules only from code when an OKF concept already covers them. Do **not** treat OKF as a substitute for reading the implementation — CodeGraph + targeted file reads remain the source of truth for *how the code is wired today*.

## Drift check before consulting OKF / CodeGraph

Users (and other tools) may edit the codebase without updating knowledge. **At the start of a task**, before using OKF for product context or CodeGraph for navigation, run a quick drift check and sync if needed.

### Detect

Run from the repo root (batch these):

1. `git status --short` — note dirty or untracked files under `src/`, `scripts/`, tests, `README.md`, `docs/architecture.md`, or the HTTP/UI surface.
2. `git log --oneline -15 -- src/ scripts/ package.json` — recent code commits.
3. `git log --oneline -10 -- okf/` and read the latest dated section of [`okf/log.md`](okf/log.md) — compare whether code moved **after** the last OKF maintenance note.
4. Optionally: `git diff HEAD -- src/ scripts/` and `git diff HEAD -- okf/` — code changed without OKF changes ⇒ OKF likely stale for those areas.
5. CodeGraph: if `.codegraph/codegraph.db` is missing, or source files are newer than the DB, or status shows code edits since the last index you know about ⇒ graph likely stale.

Treat as stale when product-relevant code (causality, tree builder, CDP session, API, UI contracts, deploy docs) changed and OKF was not updated in the same commits/working tree.

### Sync before proceeding

1. **CodeGraph** — if installed and the graph may be stale or missing: run `codegraph index` (or install/init per README on a new machine). Do this **before** graph-based navigation.
2. **OKF** — if drift affects areas relevant to the current task (or clearly affects core product rules): update the matching `okf/` concepts from the **current** source of truth, append [`okf/log.md`](okf/log.md) (note “synced after manual/out-of-band code changes”), run `npx okfgen validate okf`. Prefer fixing OKF for the task’s slice first; do not invent a full rewrite unless the whole model shifted.
3. Only after sync (or confirming no material drift) continue with OKF orient → CodeGraph navigate → implement.

If you cannot run CodeGraph, note it and fall back to targeted file reads. Never treat a known-stale OKF page as authoritative over the current code.

## When to update CodeGraph

In the **same session** as code edits, after your changes are in place, run:

```bash
codegraph index
```

Do this whenever you create, modify, rename, move, or delete source files (especially under `src/`, tests, and scripts the graph covers). Do not leave the session with a stale graph if `codegraph` is installed.

If CodeGraph is not installed on this machine, skip indexing and note that in your wrap-up; do not block the code change on it.

## When to update OKF

Update the bundle in the **same session / PR** as the code change if you change any of:

- Causality or tree-building heuristics (roots, edges, gestures, dedupe)
- Public HTTP/SSE API or UI behavior that operators rely on
- Deploy/Chrome/CDP runbooks
- Data model fields that agents or clients should know about
- New or mitigated known issues / limitations

Also update OKF when the **drift check** finds user/manual code changes that already made those areas outdated.

### How to update

1. Edit the relevant concept under `okf/` (prefer updating existing pages; add a new concept only when the topic is new).
2. Link it from the nearest `index.md` using: `* [Title](path) - description`
3. Append a dated bullet to [`okf/log.md`](okf/log.md).
4. Run: `npx okfgen validate okf` (and `npx okfgen lint okf` if available). Fix issues before finishing.

Root [`okf/index.md`](okf/index.md) may have frontmatter (`okf_version`). Nested `index.md` files must **not** have frontmatter.

## Cursor / Devin rule files

Project rules mirror this policy:

- Cursor: [`.cursor/rules/`](.cursor/rules/)
- Devin: [`.devin/rules/`](.devin/rules/)
