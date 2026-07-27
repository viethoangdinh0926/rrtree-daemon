---
type: Component
title: Tree builder
description: integrateNode builds the forest with typed edges, root dedupe, and navigation-aware subresource parenting.
resource: file:///home/viet/rrtree-daemon/src/model/tree-builder.ts
tags: [component, tree]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: tb
    resource: file:///home/viet/rrtree-daemon/src/model/tree-builder.ts
    title: src/model/tree-builder.ts
  - id: tests
    resource: file:///home/viet/rrtree-daemon/src/model/tree-builder.test.ts
    title: Fixture tests
---

# Tree builder

[`src/model/tree-builder.ts`](../../src/model/tree-builder.ts)

## Core API

| Export | Role |
|--------|------|
| `integrateNode` | Insert/update one `RrNode`; returns `TreePatch[]` |
| `recordGesture` / consume | User-interaction attribution |
| `deleteTree` / `clearTrees` | User-driven cleanup |
| `findCanonicalDocument` | Same-URL provisional Document fold (~15s) |
| `pruneEmptyRootsForUrl` | Drop empty duplicate roots |
| `setMainFrame` | Record a target's top-level frame so only top-level navigations may root a tree |
| `findRedirectingDocument` | Link a restarted navigation to the recent 3xx Document whose `Location` points at it |
| `findAttachableDocument` | Frame → loader → target-tree lookup; a hit means the tab already has a tree, so no second root |

## Indexes (`TreeState`)

- `requestIdToNodeId`, `loaderToDocument`, `frameToDocument`
- `targetToActiveTree`, `nodeIdAlias`, `mainFrameByTarget`, `recentGestures`

## Tests

Covered by [`src/model/tree-builder.test.ts`](../../src/model/tree-builder.test.ts): redirects, assets+fetch, script_nav, user_interaction, root dedupe, gesture consume, subresource parenting under click nav, and the root creation policy (address-bar root, first-gesture root, subframe/script/orphan nodes never rooting, one tree per target across repeated navigations, re-rooting only after `deleteTree`).

## Related

- [Causality rules](../architecture/causality-rules.md)
- [TreeStore](./tree-store.md)
