---
type: Known Issue
title: User interaction captured multiple times
description: A single click/Enter stayed live for 2s and tagged every Document (including iframes).
tags: [known-issue, gesture]
status: mitigated
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Symptom

One click produces many `user_interaction` edges — every Document in a ~2s window (including iframes) was tagged from the same live gesture.

# Mitigation

- Consume the gesture after the first Document uses it ([tree builder](../components/tree-builder.md)).
- Dedupe bursty gestures (~400ms) in the [CdpManager](../components/cdp-session.md) hook.
- Top-frame-only injection; only `Enter` counts for keydown.

# Related

- Causality: [causality rules](../architecture/causality-rules.md)
- Still heuristic overall: [limitations](./limitations.md)
