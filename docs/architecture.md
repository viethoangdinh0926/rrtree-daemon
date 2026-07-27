# Architecture

## Pipeline

```
Chrome (CDP :9222)  ←── may appear/disappear
    │
CdpManager           — scan /json/version → connect → attach pages;
    │                  on Chrome death → teardown → scan again
    │  Network.requestWillBeSent / responseReceived / loadingFinished
    ▼
RrAssembler          — pairs hops; materializes redirect intermediates
    ▼
TreeBuilder          — typed edges; roots vs children; loaderId/frameId indexes
    ▼
TreeStore            — in-memory forest + EventEmitter patches
    ▼
HTTP API + SSE       — /health (cdp.state), /trees, /events
    ▼
Static UI            — live expandable tree; scanning vs connected status
```

## Causality rules

1. **Redirect**: same CDP `requestId` with `redirectResponse` → finish previous hop, new hop child with `edgeType=redirect`. Restarted navigations (cross-process redirects arrive with a **new** `requestId`) are matched to a recent 3xx Document whose `Location` resolves to the new URL, so a redirect **never** starts a new tree.
2. **Document root** (only two cases): a **top-level frame** Document with browser-initiated initiator `other` and no recent in-page gesture (address bar / bookmark / reload / restore), **or** the first gesture-attributed Document when the page has no root node yet.
3. **script_nav**: Document with initiator `script` → child of active document in frame/target; dropped when no document is known.
4. **user_interaction**: Document with recent click/keydown (≈2s) and non-script initiator → child of active document when one exists.
5. **Subresources**: prefer `loaderId` → document, else same-load `initiator.requestId`, else `frameId` → document, else active document for the target.
6. **No stray roots**: subframe Documents, script navigations, and subresources that cannot be attached are dropped instead of creating a tree.

Top-level frames are learned from `Page.getFrameTree` on attach and `Page.frameNavigated` (frames without `parentId`), stored in `TreeState.mainFrameByTarget`.

## Gesture signal

On attach, the daemon injects listeners that `console.debug('__rrtree_gesture__', …)`. `Runtime.consoleAPICalled` records gestures into the store for root/edge attribution.

## Body capture

After `loadingFinished`:

- **Request body** — from `request.postData` on `requestWillBeSent`, or `Network.getRequestPostData` for POST/PUT/PATCH when needed.
- **Response body** — `Network.getResponseBody` for text-like types (Document, XHR, Fetch, Script, Stylesheet, …), capped at 256KB.
- **Headers** — from `requestWillBeSent` / `responseReceived`, merged with `*ExtraInfo` events when Chrome emits them (often includes cookie-related headers).

Binary types (Image, Media, Font) skip response body capture and record `unavailableReason: skipped_binary_or_unsupported_type`.
