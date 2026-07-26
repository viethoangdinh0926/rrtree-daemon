---
type: API Endpoint Catalog
title: API endpoints
description: REST and SSE endpoints exposed by rrtree-daemon.
resource: file:///home/viet/rrtree-daemon/src/api/server.ts
tags: [api, endpoints]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Attachment + tree counts |
| `GET` | `/trees` | List trees |
| `GET` | `/trees/:id` | Tree + nodes (headers/bodies) |
| `DELETE` | `/trees/:id` | Delete one tree |
| `DELETE` | `/trees` | Clear all trees |
| `GET` | `/nodes` | All nodes |
| `GET` | `/nodes/:id` | Single node |
| `GET` | `/nodes/:id/curl` | Minimal curl for node request |
| `GET` | `/events` | SSE patches (`upsert`/`attach`/`delete`/`clear`/`snapshot`) |
| `POST` | `/attach` | `{ "targetId" }` force-attach page |

Static UI is served from `/`.

# Examples

```bash
curl -s http://127.0.0.1:7733/health
curl -s http://127.0.0.1:7733/trees
curl -X DELETE http://127.0.0.1:7733/trees/<treeId>
curl -s http://127.0.0.1:7733/nodes/<id>/curl
```
