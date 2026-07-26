# Codebase navigation (CodeGraph)

Use CodeGraph for *where* questions. Use OKF (`okf/`) for *why/what* — see `agent-knowledge` rule and `AGENTS.md`.

Before first use in a task: drift-check (manual/user code may have left the DB stale) and run `codegraph index` if the DB is missing or source is newer — details in `AGENTS.md`.

Before sweeping `grep` or broad file search:

- Query `.codegraph/codegraph.db` via `codegraph query <symbol>`, `codegraph trace <caller>`, or MCP `codegraph_explore`.
- Trace call chains and dependency maps from the graph first.
- Open only the files the graph identifies.

After you create, modify, rename, move, or delete source files in this session, run `codegraph index` before finishing (skip only if `codegraph` is not installed).
