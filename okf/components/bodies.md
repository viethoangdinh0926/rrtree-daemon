---
type: Component
title: Body capture helpers
description: Decides which response bodies to fetch and how to truncate payloads.
resource: file:///home/viet/rrtree-daemon/src/model/bodies.ts
tags: [component, bodies]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Body helpers

[`src/model/bodies.ts`](../../src/model/bodies.ts) — used by [`CdpManager`](./cdp-session.md) after `loadingFinished` when attaching request/response payloads to an [`RrNode`](../architecture/data-model.md).

## Policy

- Cap: **256 KiB** (`BODY_MAX_BYTES`); larger bodies are truncated with a marker.
- Capture text-like types: Document, XHR, Fetch, Script, Stylesheet, and similar.
- Skip Image / Media / Font / WebSocket (binary-heavy or non-replay-oriented).
- Helpers: `truncateBody`, `shouldCaptureResponseBody`.

Bodies appear in the UI detail pane and feed the [curl generator](./curl.md) when present.
