---
type: Component
title: RrAssembler
description: Turns CDP Network events into RrNode hops, including redirect intermediates.
resource: file:///home/viet/rrtree-daemon/src/model/rr-assembler.ts
tags: [component, network]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# RrAssembler

[`src/model/rr-assembler.ts`](../../src/model/rr-assembler.ts)

## Behavior

- `handleRequestWillBeSent` — create hop; if `redirectResponse`, finish previous hop and link new hop with `edgeType=redirect`.
- `handleResponseReceived` / `loadingFinished` / `loadingFailed` — complete pair lifecycle.
- `mergeRequestExtraHeaders` / `mergeResponseExtraHeaders` — ExtraInfo merge.
- `setRequestBody` / `setResponseBody` — body attachment from CDP getters.
- Captures `postData` when present on the request event.

Redirect hops **reuse CDP `requestId`** but get distinct node ids — tree builder must not collapse them solely by requestId.

## Related

- [Tree builder](./tree-builder.md)
- [Data model](../architecture/data-model.md)
