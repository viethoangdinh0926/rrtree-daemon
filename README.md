# rrtree-daemon

Linux daemon that attaches to **Google Chrome / Chromium** over the **Chrome DevTools Protocol (CDP)** and builds **live request–response causality trees**.

Each tree is rooted at a user-triggered (or address-bar) document navigation. Child nodes are request–response pairs caused by:


| Edge                | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `redirect`          | HTTP redirect hop                                         |
| `parser`            | Subresource from the HTML/CSS parser                      |
| `script`            | XHR / `fetch` / dynamic load from script                  |
| `script_nav`        | Document navigation from script (`window.location`, etc.) |
| `user_interaction`  | Navigation attributed to a recent click / keydown         |
| `preload` / `other` | Preloads and unclassified                                 |


For every node the daemon stores:

- **Request** method, URL, headers, and body when present (`POST`/`PUT`/`PATCH` post data)
- **Response** status, headers, and body when capturable (HTML/JSON/JS/CSS/text; binary types are skipped)

---

## Requirements

- **Node.js 20+**
- **Google Chrome** or **Chromium** with remote debugging enabled
- Linux, macOS, or Windows (daemon can run on the same machine as Chrome)

---

## Deploy the app

```bash
git clone https://github.com/viethoangdinh0926/rrtree-daemon.git
cd rrtree-daemon
npm install
npm run build          # compiles TypeScript → dist/ and copies UI
```

Run in development (TypeScript via `tsx`):

```bash
npm run dev
```

Or run the built daemon:

```bash
npm start
```

By default the HTTP API + UI listen on **[http://127.0.0.1:7733/](http://127.0.0.1:7733/)**. The daemon **scans** for Chrome CDP on **127.0.0.1:9222**, connects when it appears, and returns to scanning if Chrome exits.

### Environment variables


| Variable         | Default     | Description                                      |
| ---------------- | ----------- | ------------------------------------------------ |
| `CDP_HOST`       | `127.0.0.1` | Chrome debugging host                            |
| `CDP_PORT`       | `9222`      | Chrome debugging port                            |
| `PORT`           | `7733`      | Daemon HTTP / UI port                            |
| `CAPTURE_BODIES` | `1`         | Set to `0` to skip request/response body capture |


Example:

```bash
CDP_PORT=9222 PORT=7733 npm start
```

### systemd (optional, Linux)

```bash
mkdir -p ~/.config/systemd/user
cp scripts/rrtree-daemon.service ~/.config/systemd/user/
# Edit WorkingDirectory and ExecStart paths in the unit file
systemctl --user daemon-reload
systemctl --user enable --now rrtree-daemon.service
```

---

## Start Chrome with remote debugging

Use a **dedicated user-data directory** so debugging does not interfere with your everyday Chrome profile.

### Linux

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rrtree-chrome
```

Chromium:

```bash
chromium \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rrtree-chrome
```

### macOS

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rrtree-chrome
```

### Windows (CMD) — simplest on Windows 11

Open **Command Prompt** (not PowerShell) and run:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=%TEMP%\rrtree-chrome
```

### Windows (PowerShell)

PowerShell treats bare `--flags` as its `--` operator. Use the call operator `&` and quote each argument:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  "--remote-debugging-port=9222" `
  "--user-data-dir=$env:TEMP\rrtree-chrome"
```

Or stop PowerShell parsing with `--%`:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --% --remote-debugging-port=9222 --user-data-dir=%TEMP%\rrtree-chrome
```

Or use `Start-Process`:

```powershell
Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  -ArgumentList @(
    "--remote-debugging-port=9222",
    "--user-data-dir=$env:TEMP\rrtree-chrome"
  )
```

If Chrome is installed only for your user, replace the path with:

```powershell
"$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
```

### Verify Chrome is exposing CDP

Open in a browser or use curl:

```bash
curl http://127.0.0.1:9222/json/version
```

You should see JSON including `webSocketDebuggerUrl`. If this fails, Chrome is not listening on that port (wrong flags, or another Chrome instance already owns the profile).

---

## Connect the daemon to Chrome

Order does not matter — the daemon keeps scanning until Chrome exposes CDP.

1. **Start the daemon** (`npm run dev` or `npm start`) — UI comes up immediately while CDP is in `scanning`.
2. **Start Chrome** with `--remote-debugging-port=9222` (see above), or start Chrome first.
3. Watch the daemon log for:
  ```text
   [cdp] scanning for Chrome debugging endpoint at 127.0.0.1:9222 …
   [cdp] connected to Chrome at 127.0.0.1:9222
   [cdp] attached page <targetId> (https://…)
  ```
4. Open the UI: **[http://127.0.0.1:7733/](http://127.0.0.1:7733/)** — status shows `scanning…` then `connected · N targets · M trees`.
5. Browse normally in the debug Chrome window — trees update live.
6. If Chrome exits, the daemon logs CDP lost and returns to scanning until a new debug Chrome appears.

Health check:

```bash
curl http://127.0.0.1:7733/health
```

Expected shape while connected:

```json
{
  "ok": true,
  "cdp": { "state": "connected", "host": "127.0.0.1", "port": 9222 },
  "attachedTargets": ["…"],
  "treeCount": 1
}
```

While waiting for Chrome, `cdp.state` is `"scanning"` and `attachedTargets` is empty.

### Typical failure modes


| Symptom                                 | Fix                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------- |
| UI stuck on `scanning`                  | Start Chrome with `--remote-debugging-port`; confirm `/json/version`       |
| Chrome opens but daemon does not attach | Open at least one tab; wait a few seconds (target poll)                    |
| Port already in use                     | Change `PORT` / `CDP_PORT`, or quit the other process                      |
| “Debugger attached” banner              | Expected while the daemon is connected                                     |
| Missing cookies in headers              | ExtraInfo merge is best-effort; some values stay Chrome-internal           |


---

## API


| Method   | Path              | Description                                                                               |
| -------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/health`         | Attachment + tree counts                                                                  |
| `GET`    | `/trees`          | List trees                                                                                |
| `GET`    | `/trees/:id`      | One tree + all nodes (includes headers/bodies)                                            |
| `DELETE` | `/trees/:id`      | Delete one tree and its nodes                                                             |
| `DELETE` | `/trees`          | Delete all trees                                                                          |
| `GET`    | `/nodes`          | All nodes                                                                                 |
| `GET`    | `/nodes/:id`      | Single node with full request/response detail                                             |
| `GET`    | `/nodes/:id/curl` | Minimal `curl` for the node’s request                                                     |
| `GET`    | `/events`         | SSE stream of `{ op, treeId?, node? }` patches (`upsert` / `attach` / `delete` / `clear`) |
| `POST`   | `/attach`         | `{ "targetId": "…" }` force-attach a page                                                 |


In the UI: use **×** on a tree row, **Delete selected**, or **Clear all**. Select a node and use **Copy curl** for a minimal replay command (keeps only crucial headers such as `Authorization`, `Content-Type`, `Cookie`, `Accept`, and common API/CSRF tokens).

### Node payload (headers & bodies)

Each RR node includes:

```json
{
  "url": "https://example.com/api",
  "method": "POST",
  "requestHeaders": { "content-type": "application/json", "…": "…" },
  "requestBody": { "text": "{\"q\":1}", "size": 7, "truncated": false },
  "status": 200,
  "responseHeaders": { "content-type": "application/json" },
  "responseBody": { "text": "{\"ok\":true}", "size": 11, "truncated": false }
}
```

Bodies may instead look like:

```json
{ "unavailableReason": "skipped_binary_or_unsupported_type" }
```

or

```json
{ "unavailableReason": "unavailable" }
```

Response bodies are captured for Document / XHR / Fetch / Script / Stylesheet / text-like MIME types, capped at **256 KiB** (`truncated: true` when cut). Images, fonts, and media are skipped.

---

## Tests

```bash
npm test              # fixture unit tests
npm run validate:live # headless Chrome end-to-end scenarios
```

---

## Known limitations (v0)

- SPA soft navigations without a Document request are not new tree roots.
- User-gesture attribution is heuristic (injected click/keydown hooks + time window).
- Attaching CDP shows Chrome’s debugging banner and can conflict with DevTools on the same target.
- Not a Brave PageGraph-level DOM attribution system.

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Agent knowledge (OKF + CodeGraph)

Coding agents (Cursor, Devin, etc.) should follow `[AGENTS.md](AGENTS.md)`:


| Layer                            | Role                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **OKF** (`[okf/](okf/index.md)`) | Product context — causality, API, ops, known issues. **Committed** in git. Update when business logic changes. |
| **CodeGraph** (`.codegraph/`)    | Structural navigation — symbols and call chains. Prefer over blind grep. Agents must run `codegraph index` after codebase changes. |


These are complementary, not mutually exclusive. Agents must **drift-check** for manual/out-of-band code edits and refresh stale OKF/CodeGraph **before** consulting either layer — see [`AGENTS.md`](AGENTS.md). Start at [`okf/index.md`](okf/index.md); see [maintain OKF playbook](okf/playbooks/maintain-okf.md). Project rules live under [`.cursor/rules/`](.cursor/rules/) and [`.devin/rules/`](.devin/rules/).

### Set up CodeGraph on a new machine

Each new dev environment needs its own CodeGraph install and index. The SQLite DB (`.codegraph/codegraph.db`) is **gitignored** and is not shared via clone. The daemon itself does not require CodeGraph; only agent-assisted coding benefits from it.

Requires **Node.js 22+** for CodeGraph’s native SQLite bindings.

```bash
# From the repo root
npm install -g @colbymchenry/codegraph
codegraph status
codegraph init          # once per clone (use -i for interactive)
codegraph index         # builds .codegraph/codegraph.db
```

After any codebase change in an agent session, run `codegraph index` again so the local graph stays current (skip only if CodeGraph is not installed).

Optional: wire CodeGraph MCP into Cursor / Devin / Claude Code — see [docs/install_kg.md](docs/install_kg.md).