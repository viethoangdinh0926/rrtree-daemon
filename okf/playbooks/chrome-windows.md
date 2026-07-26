---
type: Playbook
title: Start Chrome with CDP on Windows 11
description: Avoid PowerShell -- parsing errors when enabling remote debugging.
tags: [playbook, windows, chrome]
generated:
  by: agent/cursor-grok
  at: 2026-07-26T18:54:43Z
---

# Trigger

PowerShell error: `Unexpected token 'remote-debugging-port=9222'` / `'--' operator works only on variables`.

# Cause

PowerShell treats bare `--flags` as its decrement operator.

# Steps

**CMD (simplest):**

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=%TEMP%\rrtree-chrome
```

**PowerShell (quote flags):**

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  "--remote-debugging-port=9222" `
  "--user-data-dir=$env:TEMP\rrtree-chrome"
```

Or `Start-Process … -ArgumentList @(…)`.

Verify: open `http://127.0.0.1:9222/json/version`.
