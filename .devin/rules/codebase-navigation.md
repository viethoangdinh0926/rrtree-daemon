# Codebase Navigation Rules

Always inspect the local code graph file before performing sweeping `grep` or file search actions.

- Check `.codegraph/codegraph.db` or run `codegraph query <symbol>` to evaluate structural layers.
- Trace function call chains and dependency maps via the graph file first.
- Only load exact files identified by the graph to keep token context windows narrow.