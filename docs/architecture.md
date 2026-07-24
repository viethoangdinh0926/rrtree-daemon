# Architecture

## Pipeline

```
Chrome (CDP :9222)
    │  Network.requestWillBeSent / responseReceived / loadingFinished
    ▼
RrAssembler          — pairs hops; materializes redirect intermediates
    ▼
TreeBuilder          — typed edges; roots vs children; loaderId/frameId indexes
    ▼
TreeStore            — in-memory forest + EventEmitter patches
    ▼
HTTP API + SSE       — /trees, /events
    ▼
Static UI            — live expandable tree
```

## Causality rules

1. **Redirect**: same CDP `requestId` with `redirectResponse` → finish previous hop, new hop child with `edgeType=redirect`.
2. **Document root**: `resourceType=Document` and initiator `other` (or first nav after gesture with no parent doc).
3. **script_nav**: Document with initiator `script` → child of active document in frame/target.
4. **user_interaction**: Document with recent click/keydown (≈2s) and non-script initiator → child of active document when one exists.
5. **Subresources**: prefer `initiator.requestId`, else `loaderId` → document, else `frameId` → document.

## Gesture signal

On attach, the daemon injects listeners that `console.debug('__rrtree_gesture__', …)`. `Runtime.consoleAPICalled` records gestures into the store for root/edge attribution.

## Body capture

After `loadingFinished`, for Document / XHR / Fetch, optionally call `Network.getResponseBody` and store up to 256KB as `bodyPreview`.
