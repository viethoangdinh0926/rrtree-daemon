---
type: Known Issue
title: Assets not under user_interaction document
description: After a click navigation, subresources appeared as siblings under the previous page root.
tags: [known-issue, parenting]
status: mitigated
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Symptom

User interaction node created; many following nodes are not its children despite no further user action.

# Cause

Main-frame `frameId` is stable across navigations. Fallback parenting used stale frame document or `tree.rootId` (old page).

# Mitigation

Prefer **loaderId → document** for subresources; trust initiator only when it belongs to the same load; fall back to newest frame Document / active Document — never blind tree root.

# Related

- [Causality rules](../architecture/causality-rules.md)
