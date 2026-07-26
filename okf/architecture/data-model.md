---
type: Reference
title: Data model
description: RrNode, BodyPayload, Tree, TreePatch, and edge vocabulary.
tags: [architecture, data-model]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
resource: file:///home/viet/rrtree-daemon/src/model/types.ts
sources:
  - id: types
    resource: file:///home/viet/rrtree-daemon/src/model/types.ts
    title: src/model/types.ts
---

# Schema

Primary types live in [`src/model/types.ts`](../../src/model/types.ts).

## `RrNode` (request–response pair)

| Field | Meaning |
|-------|---------|
| `id` / `requestId` | Internal node id / CDP request id |
| `url`, `method`, `resourceType` | Request identity |
| `status`, `mimeType` | Response summary |
| `requestHeaders`, `responseHeaders` | Header maps (ExtraInfo merged when present) |
| `requestBody`, `responseBody` | Optional [`BodyPayload`](../../src/model/types.ts) |
| `parentId`, `edgeType`, `children` | Tree links |
| `frameId`, `loaderId`, `targetId` | Browser causality keys |
| `initiator` | CDP initiator summary |
| `treeId` | Owning tree |
| `hasResponse`, `finished`, `failed` | Lifecycle flags |

## `BodyPayload`

```
text? | base64? | base64Encoded? | size? | truncated? | unavailableReason?
```

Binary/skipped types use `unavailableReason` (e.g. `skipped_binary_or_unsupported_type`).

## `Tree` / `TreePatch`

- `Tree`: `{ id, rootId, targetId?, createdAt, updatedAt }`
- `TreePatch.op`: `upsert` | `attach` | `delete` | `clear`

## Related

- [Causality rules](./causality-rules.md)
- [curl generator](../components/curl.md)
