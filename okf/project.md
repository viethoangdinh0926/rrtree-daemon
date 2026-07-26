---
type: Project
title: rrtree-daemon
description: CDP-attached daemon that builds live typed request–response causality trees from Chrome traffic.
resource: file:///home/viet/rrtree-daemon
tags: [project, chrome, cdp, network, daemon]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: readme
    resource: file:///home/viet/rrtree-daemon/README.md
    title: Project README
  - id: arch
    resource: file:///home/viet/rrtree-daemon/docs/architecture.md
    title: Architecture notes
---

# Overview

**rrtree-daemon** observes a running Chrome/Chromium instance over the Chrome DevTools Protocol and maintains an in-memory forest of request–response (RR) trees. Trees are queryable via a local HTTP API and rendered in a static UI with live SSE updates.

## Differentiation

| Existing tools | Gap this fills |
|----------------|----------------|
| DevTools Initiator / HAR viewers | No daemon API; not user-rooted session trees |
| mitmproxy / HTTP Toolkit | Strong pairs; weak browser causality |
| Brave PageGraph / UnderPixel | Research/extension focus; different product shape |

This project is a **causal session model**, not another waterfall viewer.

## Runtime defaults

| Setting | Default |
|---------|---------|
| CDP | `127.0.0.1:9222` |
| API/UI | `http://127.0.0.1:7733` |
| Body capture | on (`CAPTURE_BODIES!=0`), 256 KiB cap |

## Agent knowledge

Agents should use OKF (this bundle) for product context and CodeGraph for code navigation — see [Maintain OKF and CodeGraph](./playbooks/maintain-okf.md). Repo policy: `AGENTS.md`.

## Related

- Pipeline: [architecture/pipeline](./architecture/pipeline.md)
- Deploy: [playbooks/deploy-and-connect](./playbooks/deploy-and-connect.md)
- Components: [components/index](./components/index.md)
