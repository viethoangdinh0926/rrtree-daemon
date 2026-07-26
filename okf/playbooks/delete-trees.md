---
type: Playbook
title: Delete trees
description: Remove one tree or clear the entire forest from UI or API.
tags: [playbook, ops]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Delete trees

Use when the forest is cluttered or a bad root should be removed. Persistence is in-memory only ([TreeStore](../components/tree-store.md)), so deletes do not touch Chrome.

## UI

In the [live UI](../components/ui.md):

- **×** on a tree row
- **Delete selected**
- **Clear all** (confirm)

## API

```bash
curl -X DELETE http://127.0.0.1:7733/trees/<treeId>
curl -X DELETE http://127.0.0.1:7733/trees
```

SSE clients receive `delete` / `clear` patches ([endpoints](../api/endpoints.md)).
