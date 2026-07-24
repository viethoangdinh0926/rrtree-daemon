# rrtree-daemon

Linux prototype daemon that attaches to Chrome via the **Chrome DevTools Protocol (CDP)** and builds **live request–response causality trees**.

Each tree is rooted at a user-triggered (or address-bar) document navigation. Children are attached with typed edges:

| Edge | Meaning |
|------|---------|
| `redirect` | HTTP redirect hop (`Network.requestWillBeSent.redirectResponse`) |
| `parser` | Subresource discovered by the HTML/CSS parser |
| `script` | XHR/fetch/dynamic load from script |
| `script_nav` | Document navigation initiated by script (`window.location`, etc.) |
| `user_interaction` | Navigation attributed to a recent click/keydown |
| `preload` / `other` | Preloads and unclassified |

## Requirements

- Node.js 20+
- Google Chrome / Chromium with remote debugging enabled

## Quick start

```bash
# Terminal 1 — Chrome (dedicated profile avoids clobbering your main session)
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rrtree-chrome

# Terminal 2 — daemon
cd /path/to/rrtree-daemon
npm install
npm run dev
```

Open the UI: [http://127.0.0.1:7733/](http://127.0.0.1:7733/)

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_HOST` | `127.0.0.1` | Chrome debugging host |
| `CDP_PORT` | `9222` | Chrome debugging port |
| `PORT` | `7733` | Daemon HTTP / UI port |
| `CAPTURE_BODIES` | `1` | Set `0` to skip `Network.getResponseBody` |

## API

- `GET /health` — attachment + tree counts
- `GET /trees` — list trees
- `GET /trees/:id` — tree + nodes
- `GET /nodes` — all nodes
- `GET /events` — SSE stream of `{ op, treeId, node }` patches
- `POST /attach` — `{ "targetId": "..." }` force-attach a page target

## systemd (user unit)

See [scripts/rrtree-daemon.service](scripts/rrtree-daemon.service).

```bash
mkdir -p ~/.config/systemd/user
cp scripts/rrtree-daemon.service ~/.config/systemd/user/
# edit WorkingDirectory / ExecStart paths
systemctl --user daemon-reload
systemctl --user enable --now rrtree-daemon.service
```

## Tests

```bash
npm test              # fixture unit tests
npm run validate:live # headless Chrome: redirect, assets, fetch, script_nav, click-nav
```

Fixture-driven coverage: redirect chains, document+assets+fetch, `script_nav`, and click → `user_interaction`.

## Known limitations (v0)

- SPA soft navigations without a Document request are not tree roots.
- User-gesture attribution is heuristic (injected click/keydown hooks + time window).
- Attaching CDP shows Chrome’s “debugging” banner and can conflict with DevTools on the same target.
- Not a full PageGraph-style DOM attribution system.

## Architecture

See [docs/architecture.md](docs/architecture.md).
