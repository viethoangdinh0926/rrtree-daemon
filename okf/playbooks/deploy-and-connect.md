---
type: Playbook
title: Deploy daemon and connect Chrome
description: Steps to install rrtree-daemon, start Chrome with CDP, and open the UI.
tags: [playbook, deploy, chrome]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
sources:
  - id: readme
    resource: file:///home/viet/rrtree-daemon/README.md
    title: README quick start
---

# Trigger

Need a live request–response tree view for a Chrome browsing session.

# Steps

1. **Install**
   ```bash
   cd rrtree-daemon
   npm install
   npm run build   # optional for production
   ```

2. **Start Chrome** with remote debugging and a dedicated profile:
   ```bash
   # Linux
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/rrtree-chrome
   ```
   Verify: `curl http://127.0.0.1:9222/json/version`

3. **Start daemon**
   ```bash
   npm run dev
   # or: npm start
   ```

4. **Open UI**: http://127.0.0.1:7733/

5. Confirm log lines like `[cdp] attached page …` and `/health` shows `attachedTargets`.

# Env

| Variable | Default |
|----------|---------|
| `CDP_HOST` | `127.0.0.1` |
| `CDP_PORT` | `9222` |
| `PORT` | `7733` |
| `CAPTURE_BODIES` | `1` |

# Optional systemd

See [`scripts/rrtree-daemon.service`](../../scripts/rrtree-daemon.service).

# Related

- [Chrome on Windows](./chrome-windows.md)
- [API endpoints](../api/endpoints.md)
