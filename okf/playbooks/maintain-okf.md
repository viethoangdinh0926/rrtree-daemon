---
type: Playbook
title: Maintain OKF and CodeGraph for agents
description: How coding agents should drift-check, use, and update OKF vs CodeGraph during project work.
tags: [playbook, agents, okf, codegraph]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T19:10:00Z
---

# Maintain agent knowledge (OKF + CodeGraph)

They are **not** mutually exclusive.

| Layer | Answers | Update when |
|-------|---------|-------------|
| [OKF](../index.md) | Product rules, causality, API, ops, known issues (**committed**) | Your changes **or** drift check finds manual/out-of-band code edits |
| CodeGraph (`.codegraph/`) | Symbols, callers, file paths (**local DB; gitignored**) | New machine: install + init + index; before navigation if stale; after every code-change session |

New environments: see the repo README section “Set up CodeGraph on a new machine” (`npm install -g @colbymchenry/codegraph`, then `codegraph init` and `codegraph index`). MCP wiring details live in `docs/install_kg.md` (outside this bundle).

## Agent workflow

1. **Drift check** (before trusting knowledge): compare recent `src/` / `scripts/` changes (`git status`, `git log`, diff) against `okf/` and [`log.md`](../log.md). If CodeGraph DB is missing or older than sources, re-index. If OKF lags product-relevant code, sync the affected concepts from current source, append this log, validate.
2. Orient: read [`okf/index.md`](../index.md) and relevant concepts.
3. Navigate: CodeGraph → open exact files.
4. Implement in `src/` (and related project files).
5. If behavior/API/ops/known-issues changed: edit OKF concepts, link from the nearest index (`* [Title](path) - description`), append [`log.md`](../log.md), then `npx okfgen validate okf`.
6. Before finishing: run `codegraph index` (skip only if CodeGraph is not installed).

Canonical instructions for Cursor/Devin: repo-root `AGENTS.md`, plus `.cursor/rules/agent-knowledge.mdc` and `.devin/rules/agent-knowledge.md`.
