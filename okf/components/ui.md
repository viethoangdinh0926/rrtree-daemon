---
type: Component
title: Live tree UI
description: Single-page UI for tree list, expandable RR tree, node detail, delete, and curl copy.
resource: file:///home/viet/rrtree-daemon/src/ui/index.html
tags: [component, ui]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# UI

[`src/ui/index.html`](../../src/ui/index.html) (copied to `dist/ui` on build).

## Features

- Tree list with delete (×), Delete selected, Clear all
- Expandable request tree with edge badges
- Detail pane: headers/bodies + **Copy curl**
- Live updates via `EventSource('/events')`

## Related

- [curl](./curl.md)
- [Playbook: delete trees](../playbooks/delete-trees.md)
