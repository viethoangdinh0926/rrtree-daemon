---
type: Reference
title: Causality rules
description: Rules that attach RR nodes as roots or typed children in the forest.
tags: [architecture, causality, edges]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: tree-builder
    resource: file:///home/viet/rrtree-daemon/src/model/tree-builder.ts
    title: integrateNode / resolveParent
---

# Causality rules

Implemented primarily in [`resolveParent`](../../src/model/tree-builder.ts) and [`integrateNode`](../../src/model/tree-builder.ts).

## Edge types

| Edge | When |
|------|------|
| `redirect` | Same CDP `requestId` with `redirectResponse` → previous hop finished, new hop child |
| `user_interaction` | Document after recent click/Enter gesture; consumed after first Document |
| `script_nav` | Document with initiator `script` under active frame/target document |
| `parser` / `script` / `preload` / `other` | Subresources via initiator + navigation load |

## Document roots

- Address-bar style Document (`initiator` `other`/`parser`) without a usable gesture → **new root**.
- Gesture present → prefer child of current frame/target document with `user_interaction`, then consume gesture.
- Duplicate same-URL Documents within ~15s fold into a canonical Document; empty sibling roots are pruned.

## Subresources (post-navigation)

Order of parent resolution (important after click navigations):

1. **loaderId** → document for this navigation (preferred).
2. **initiator.requestId** only if that initiator belongs to the same load.
3. Newest Document on the same **frameId** (main frame id is reused across navigations).
4. Active Document for target — **not** blind `tree.rootId`.

This prevents new-page assets from appearing as siblings of a `user_interaction` node under the previous page.

## Gestures

Top-frame inject listens for `click` and `Enter` `keydown`, emits `console.debug('__rrtree_gesture__', …)`. Debounced in-page (~400ms) and in [`recordGesture`](../../src/model/tree-builder.ts).

## Related

- [Data model](./data-model.md)
- [Known issues: gesture](../known-issues/gesture-attribution.md)
- [Known issues: subresource parenting](../known-issues/subresource-parenting.md)
