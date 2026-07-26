---
type: Component
title: CdpManager
description: Attaches to Chrome page targets, enables Network/Page/Runtime, feeds RR events and gestures into the store.
resource: file:///home/viet/rrtree-daemon/src/cdp/session.ts
tags: [component, cdp]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: session
    resource: file:///home/viet/rrtree-daemon/src/cdp/session.ts
    title: src/cdp/session.ts
---

# CdpManager

Class in [`src/cdp/session.ts`](../../src/cdp/session.ts) (CodeGraph: `CdpManager`).

## Responsibilities

- Connect to browser CDP (`CDP_HOST`/`CDP_PORT`).
- Discover/attach `page` targets; poll every 3s.
- Enable `Network`, `Page`, `Runtime`.
- Inject top-frame gesture hook (`click` / `Enter`).
- Forward Network events to per-target [`RrAssembler`](./rr-assembler.md).
- Merge ExtraInfo headers; capture request/response bodies after `loadingFinished`.
- Ingest assembled nodes into [`TreeStore`](./tree-store.md).

## Key methods

| Method | Role |
|--------|------|
| `start` / `stop` | Lifecycle |
| `attachTarget` | Manual attach via API |
| `maybeAttach` | Auto-attach page targets |
| `captureBodiesForNode` | postData + getResponseBody |

## Related

- [Pipeline](../architecture/pipeline.md)
- [RrAssembler](./rr-assembler.md)
