---
type: Component
title: CdpManager
description: Scans for Chrome CDP, attaches page targets, enables Network/Page/Runtime, feeds RR events and gestures into the store.
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

- **Scan** for a Chrome debugging endpoint at `CDP_HOST`/`CDP_PORT` (HTTP `/json/version`, default every 2s).
- **Connect** when Chrome appears; discover/attach `page` targets; poll targets while connected (default 3s).
- On browser WebSocket **disconnect** or failed target refresh: detach pages, tear down the browser client, and **return to scanning**.
- Enable `Network`, `Page`, `Runtime`.
- Inject top-frame gesture hook (`click` / `Enter`).
- Forward Network events to per-target [`RrAssembler`](./rr-assembler.md).
- Merge ExtraInfo headers; capture request/response bodies after `loadingFinished`.
- Ingest assembled nodes into [`TreeStore`](./tree-store.md).

`start()` does **not** require Chrome to already be running. Connection state is exposed via `getStatus()` (`scanning` | `connected`).

## Key methods

| Method | Role |
|--------|------|
| `start` / `stop` | Lifecycle (scan loop + optional connect) |
| `getStatus` | `scanning`/`connected`, host/port, attached targets, last error |
| `attachTarget` | Manual attach via API (only while connected) |
| `maybeAttach` | Auto-attach page targets |
| `captureBodiesForNode` | postData + getResponseBody |

## Related

- [Pipeline](../architecture/pipeline.md)
- [RrAssembler](./rr-assembler.md)
- [Deploy and connect](../playbooks/deploy-and-connect.md)
