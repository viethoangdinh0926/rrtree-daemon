---
type: Component
title: TreeStore
description: EventEmitter façade over TreeState for ingest, gestures, queries, and deletes.
resource: file:///home/viet/rrtree-daemon/src/model/store.ts
tags: [component, store]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# TreeStore

[`src/model/store.ts`](../../src/model/store.ts)

## Methods

| Method | Emits |
|--------|-------|
| `ingest(node)` | `patch` per returned `TreePatch` |
| `gesture(g)` | `gesture` |
| `getTrees` / `getTree` / `getAllNodes` | — |
| `deleteTree` / `clearTrees` | `patch` with `op: delete` / `clear` |

SSE clients subscribe to `patch` via [API server](./api-server.md).
