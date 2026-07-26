---
type: Component
title: Minimal curl generator
description: Builds a simple curl command from an RrNode, keeping only crucial headers.
resource: file:///home/viet/rrtree-daemon/src/model/curl.ts
tags: [component, curl]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# nodeToCurl

[`src/model/curl.ts`](../../src/model/curl.ts) — also mirrored in the UI for offline copy.

## Kept headers (allowlist)

`Authorization`, `Content-Type`, `Cookie`, `Accept`, `x-api-key`, `x-auth-token`, `x-csrf-token`, `x-xsrf-token`, `x-requested-with`.

Dropped: `User-Agent`, `sec-*`, `Accept-Encoding`, `Host`, `Origin`, `Referer`, etc.

## API

`GET /nodes/:id/curl` → `{ curl, nodeId }`

## Examples

See [`src/model/curl.test.ts`](../../src/model/curl.test.ts).
