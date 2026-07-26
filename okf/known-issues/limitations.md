---
type: Known Issue
title: Prototype limitations
description: Intentional v0 limits that remain open.
tags: [known-issue, limitations]
status: open
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Open limitations (v0)

rrtree-daemon is a causality-session prototype, not a full browser graph. Known open limits:

- SPA soft navigations without a Document request are not new roots ([causality rules](../architecture/causality-rules.md)).
- User-gesture attribution remains heuristic (injected hooks + time window); see [gesture attribution](./gesture-attribution.md).
- CDP attach shows Chrome’s debugging banner and can conflict with DevTools on the same target ([deploy](../playbooks/deploy-and-connect.md)).
- Not Brave PageGraph-level script↔DOM attribution ([project overview](../project.md)).
- Iframe Documents may still become separate trees when not folded by URL heuristics ([duplicate roots](./duplicate-roots.md)).
- Intentional re-navigation to the same URL within ~15s may fold into the prior Document.
