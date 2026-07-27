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
| `redirect` | Same CDP `requestId` with `redirectResponse` → previous hop finished, new hop child; also a restarted navigation matched to a recent 3xx `Location` |
| `user_interaction` | Document after recent click/Enter gesture; consumed after first Document |
| `script_nav` | Document with initiator `script` under active frame/target document |
| `parser` / `script` / `preload` / `other` | Subresources via initiator + navigation load |

## Document roots

Only two situations create a root (tree):

1. **Address-bar navigation** — Document in the **top-level frame** with browser-initiated initiator (`other`), and no recent in-page gesture. Omnibox typing/Enter never reaches the injected page hook, so the absence of a gesture is the address-bar signal. Bookmarks, reload, session restore, and back/forward look identical and also root a tree.
2. **First interaction on an untracked page** — a gesture-attributed Document when no page document exists yet for that frame/target.

**Redirects never create a tree.** Before the root rules run, a Document is matched against recent (<15s, same target) Documents with a 3xx status whose `Location` header (resolved against the responding URL, case-insensitive header lookup) equals the new URL — this covers cross-process / restarted navigations that Chrome reports with a **new** `requestId` and no `redirectResponse`. Such hops become `redirect` children. A redirect hop whose previous hop was pruned falls back to the frame/loader/target document, or is dropped; it never roots a tree.

Everything else is attached or discarded:

- Gesture present **and** a page document exists → `user_interaction` child; gesture is consumed.
- Subframe Documents → child of the embedding document; **dropped** when no page document is known.
- `script` Documents → `script_nav` child; **dropped** when no page document is known.
- Orphan subresources (no loader/frame/target document) → **dropped**, never rooted.
- Duplicate same-URL Documents within ~15s fold into a canonical Document; empty sibling roots are pruned.

Top-level detection uses `TreeState.mainFrameByTarget`, populated by `setMainFrame` from `Page.getFrameTree` at attach and `Page.frameNavigated` (frames without `parentId`). When the main frame is unknown the policy stays permissive (treats the Document as top-level) so capture still works before the frame tree arrives.

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
