---
okf_version: "0.1"
---

# rrtree-daemon

Linux/Node daemon that attaches to Chrome via CDP and builds live request–response causality trees, exposed over HTTP/SSE and a local UI.

## Overview

* [Project overview](project.md) - What the product is, defaults, and differentiation
* [Change log](log.md) - Bundle history

## Architecture

* [Architecture index](architecture/index.md) - Pipeline, causality, and data model
* [Pipeline](architecture/pipeline.md) - CDP → assembler → tree → API → UI
* [Causality rules](architecture/causality-rules.md) - How roots and typed edges are chosen
* [Data model](architecture/data-model.md) - RrNode, bodies, trees, patches

## Components

* [Components index](components/index.md) - Runtime modules
* [CdpManager](components/cdp-session.md) - Scan/connect/reconnect CDP, attach pages, gestures
* [RrAssembler](components/rr-assembler.md) - Request/response hop pairing and redirects
* [Tree builder](components/tree-builder.md) - integrateNode, dedupe, parenting
* [TreeStore](components/tree-store.md) - In-memory forest and patch events
* [API server](components/api-server.md) - Express REST + SSE + static UI
* [UI](components/ui.md) - Live tree viewer
* [curl generator](components/curl.md) - Minimal replay commands
* [Body helpers](components/bodies.md) - Capture/truncate policy

## API and operations

* [API index](api/index.md) - Local HTTP surface
* [Endpoints](api/endpoints.md) - Method/path catalog
* [Playbooks](playbooks/index.md) - Deploy and ops runbooks
* [Deploy and connect](playbooks/deploy-and-connect.md) - Install, Chrome CDP, start daemon
* [Chrome on Windows](playbooks/chrome-windows.md) - PowerShell-safe launch flags
* [Delete trees](playbooks/delete-trees.md) - UI and API cleanup
* [Maintain OKF and CodeGraph](playbooks/maintain-okf.md) - Agent workflow for both knowledge layers

## Known issues

* [Known issues index](known-issues/index.md) - Heuristics and pitfalls
* [Duplicate roots](known-issues/duplicate-roots.md) - Provisional Document fold/prune
* [Gesture attribution](known-issues/gesture-attribution.md) - One interaction, one edge
* [Subresource parenting](known-issues/subresource-parenting.md) - Assets under new navigation
* [Limitations](known-issues/limitations.md) - Open v0 limits
