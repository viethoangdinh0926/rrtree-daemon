---
type: Component
title: HTTP API server
description: Express app serving REST, SSE patches, static UI, and curl generation.
resource: file:///home/viet/rrtree-daemon/src/api/server.ts
tags: [component, api]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# API server

[`src/api/server.ts`](../../src/api/server.ts) — `createApp` / `startServer`.

Listens on `127.0.0.1:$PORT` (default **7733**). Wraps a [`TreeStore`](./tree-store.md) for forest queries, deletes, and SSE patch fan-out. Serves the static [UI](./ui.md) from `src/ui` or `dist/ui`, and exposes node curl via the [curl generator](./curl.md).

Full method/path catalog: [Endpoints](../api/endpoints.md). Deploy steps: [Deploy and connect](../playbooks/deploy-and-connect.md).
