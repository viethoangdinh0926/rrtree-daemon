# rrtree-daemon

Linux daemon that attaches to **Google Chrome / Chromium** over the **Chrome DevTools Protocol (CDP)** and builds **live request–response causality trees**.

Each tree is rooted at a user-triggered (or address-bar) document navigation. Child nodes are request–response pairs caused by:

| Edge | Meaning |
|------|---------|
| `redirect` | HTTP redirect hop |
| `parser` | Subresource from the HTML/CSS parser |
| `script` | XHR / `fetch` / dynamic load from script |
| `script_nav` | Document navigation from script (`window.location`, etc.) |
| `user_interaction` | Navigation attributed to a recent click / keydown |
| `preload` / `other` | Preloads and unclassified |

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

By default the HTTP API + UI listen on **http://127.0.0.1:7733/** and the daemon expects Chrome CDP on **127.0.0.1:9222**.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_HOST` | `127.0.0.1` | Chrome debugging host |
| `CDP_PORT` | `9222` | Chrome debugging port |
| `PORT` | `7733` | Daemon HTTP / UI port |
| `CAPTURE_BODIES` | `1` | Set to `0` to skip request/response body capture |

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

1. **Start Chrome** with `--remote-debugging-port=9222` (see above).
2. **Start the daemon** (`npm run dev` or `npm start`).
3. Watch the daemon log for lines like:
   ```text
   [cdp] attached page <targetId> (https://…)
   [api] listening on http://127.0.0.1:7733
   ```
4. Open the UI: **http://127.0.0.1:7733/**
5. Browse normally in the debug Chrome window — trees update live.

Health check:

```bash
curl http://127.0.0.1:7733/health
```

Expected shape:

```json
{ "ok": true, "attachedTargets": ["…"], "treeCount": 1 }
```

If `attachedTargets` is empty, Chrome is not reachable at `CDP_HOST`/`CDP_PORT`, or there is no open page tab yet.

### Typical failure modes

| Symptom | Fix |
|---------|-----|
| `CDP connect failed` | Start Chrome with `--remote-debugging-port` first; confirm `/json/version` |
| Chrome opens but daemon does not attach | Open at least one tab; wait a few seconds (target poll) |
| Port already in use | Change `PORT` / `CDP_PORT`, or quit the other process |
| “Debugger attached” banner | Expected while the daemon is connected |
| Missing cookies in headers | ExtraInfo merge is best-effort; some values stay Chrome-internal |

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Attachment + tree counts |
| `GET` | `/trees` | List trees |
| `GET` | `/trees/:id` | One tree + all nodes (includes headers/bodies) |
| `GET` | `/nodes` | All nodes |
| `GET` | `/nodes/:id` | Single node with full request/response detail |
| `GET` | `/events` | SSE stream of `{ op, treeId, node }` patches |
| `POST` | `/attach` | `{ "targetId": "…" }` force-attach a page |

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
