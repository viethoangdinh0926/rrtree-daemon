---
type: Reference
title: Capture and serve pipeline
description: Chrome CDP events flow through assembler, tree builder, store, and HTTP/SSE.
tags: [architecture, pipeline, cdp]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: arch-doc
    resource: file:///home/viet/rrtree-daemon/docs/architecture.md
    title: docs/architecture.md
  - id: index-ts
    resource: file:///home/viet/rrtree-daemon/src/index.ts
    title: Process entry point
---

# Pipeline

```
Chrome (CDP :9222)  ←── may appear/disappear
    │
CdpManager           — scan /json/version → connect → attach pages
    │                  on Chrome death: teardown → scan again
    │  Network.requestWillBeSent / responseReceived / loadingFinished|Failed
    │  (+ ExtraInfo header merges, gesture console.debug)
    ▼
RrAssembler          — pair hops; materialize redirect intermediates
    ▼
integrateNode        — typed edges; root dedupe; loaderId/frame indexes
    ▼
TreeStore            — in-memory forest + EventEmitter patches
    ▼
HTTP API + SSE       — /health (cdp.state), /trees, /events, /nodes/:id/curl
    ▼
Static UI            — live tree; status shows scanning vs connected
```

## Process wiring

[`src/index.ts`](../../src/index.ts) constructs `TreeStore` + `CdpManager`, calls `cdp.start()` (begins scanning; does not exit if Chrome is absent), then `startServer({ store, cdp })`.

## Related components

- [CdpManager](../components/cdp-session.md)
- [RrAssembler](../components/rr-assembler.md)
- [Tree builder](../components/tree-builder.md)
- [API server](../components/api-server.md)
