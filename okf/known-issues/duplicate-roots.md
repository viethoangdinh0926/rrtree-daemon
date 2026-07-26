---
type: Known Issue
title: Duplicate Document roots on navigation
description: Chrome may emit multiple Document requests for one URL; empty roots must collapse into the growing tree.
tags: [known-issue, roots]
status: mitigated
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Symptom

Loading one URL creates several identical tree roots; only one grows children.

# Mitigation

In [`tree-builder.ts`](../../src/model/tree-builder.ts):

- `findCanonicalDocument` — fold same-URL Documents within ~15s (prefer grown).
- `pruneEmptyRootsForUrl` — delete empty sibling roots.
- Do not map redirect hops solely by shared CDP `requestId`.

# Related

- [Causality rules](../architecture/causality-rules.md)
