# Log

## 2026-07-27

- Root creation restricted: a tree root is now created **only** for a top-level browser-initiated Document (address-bar/bookmark/reload/restore, no in-page gesture) or for the first gesture-attributed Document on a page with no root yet. Subframe Documents, `script` navigations, and orphan subresources attach to a known document or are dropped instead of minting trees (`resolveParent`/`integrateNode` in `src/model/tree-builder.ts`).
- Added `TreeState.mainFrameByTarget` + `setMainFrame`, exposed via `TreeStore.setMainFrame` and fed from `Page.getFrameTree` / `Page.frameNavigated` in `src/cdp/session.ts`; `Page` domain typings extended in `src/types/chrome-remote-interface.d.ts`.
- New `root creation policy` tests in `src/model/tree-builder.test.ts`; updated [Causality rules](architecture/causality-rules.md) and [Tree builder](components/tree-builder.md).
- **One tree per target**: `findAttachableDocument` (frame doc → loader doc → target's active tree, existence-checked) now gates root creation, so a tab with a tree attaches further navigations (address-bar ones as `other` children) instead of rooting a second tree; a target can root again only after `deleteTree`/`clearTrees`. Tests updated accordingly (`deleteTree` test now uses two targets).
- Redirects never create a tree: `findRedirectingDocument` links a restarted navigation (new CDP `requestId`, no `redirectResponse`) to the recent 3xx Document whose resolved `Location` matches, and an orphaned redirect hop falls back to the frame/loader/target document or is dropped (`src/model/tree-builder.ts`). Covered by the `redirects never create a new tree` tests.

## 2026-07-26

- Initial OKF v0.1 bundle generated from project source, README, architecture docs, and CodeGraph index (`.codegraph/codegraph.db`).
- Covered pipeline, components (`CdpManager`, `RrAssembler`, `integrateNode`, `TreeStore`, API, UI, curl), API surface, deploy playbooks, and known causality heuristics.
- Added playbook [Maintain OKF and CodeGraph](playbooks/maintain-okf.md) and repo agent instructions (`AGENTS.md`, Cursor/Devin rules) so coding agents orient on OKF, navigate with CodeGraph, and update OKF when business logic changes.
- Documented that `.codegraph/codegraph.db` is gitignored and must be installed/indexed per new dev environment (README + this playbook).
- Agents must run `codegraph index` after codebase changes in the same session (`AGENTS.md`, Cursor/Devin rules, maintain playbook).
- Agents must **drift-check** for manual/out-of-band user code changes before consulting OKF/CodeGraph, and sync stale knowledge first (`AGENTS.md`, Cursor/Devin rules, maintain playbook).
- CDP lifecycle: daemon actively scans `CDP_HOST`:`CDP_PORT` (`/json/version`), connects when Chrome appears, and returns to scanning when the browser process/WebSocket dies (`CdpManager` in `src/cdp/session.ts`; `/health` exposes `cdp.state`).
