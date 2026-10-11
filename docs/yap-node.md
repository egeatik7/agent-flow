# Yap node

Yap replaces the old initiative execution engine. The persisted node kind remains `ai`, so existing node IDs, package membership, loop membership and connections load without a graph rewrite. Default `İnisiyatif` titles become `Yap`; custom titles remain intact. Old `engine`, `path` and `trace` fields are readable for compatibility but never replayed. New nodes expose only the completion output; legacy `fail` edges remain serialized and are used if a legacy node cannot complete.

The normal task agent uses the same desktop executor and tool definitions as recovery. It receives its rendered task, current loop variables, enclosing context and adjacent steps. It can read the canvas when necessary. It receives no recovery failure, previous reports or historical error logs, and cannot execute other nodes or change the graph. Completion requires observation after desktop input. Tool errors are returned to the model; user cancellation, time limits and exhausted call budgets stop execution.

Windows tools shared by Yap and recovery:

- `window_action`: maximize, minimize, restore, focus, move, resize, topmost and notopmost. An explicit title must match exactly one process main window; absent title targets the foreground window. Nubbo itself is rejected. Maximizing is not F11 fullscreen.
- `powershell_run`: a fresh noninteractive PowerShell process with UTF16 encoded arguments, optional working directory, bounded stdout/stderr, a 60-second per-call limit, and process-tree termination on cancellation. This runs with the user's privileges and is not a sandbox. Detached background work is forbidden by the agent instructions, not technically prevented.

Yap allows code by default; its advanced settings can disable it. Recovery code execution is off by default and can be enabled in recovery settings. Existing recovery desktop/node permissions retain their behavior.

Yap uses its model/backups and the general API key. Legacy UI-TARS model entries are excluded because this engine requires function calling; the general model is the fallback. `local:` models use the existing local endpoint and require tool-calling and image support. Recovery retains its separate OpenRouter configuration.

Validation: TypeScript checks, application build, 703 passing tests (5 skipped), including mocked task/PowerShell execution tests. Real Windows window manipulation, PowerShell termination and live model task completion still require a Windows desktop run. The two delivered Hunyuan canvases contain no `ai` nodes, including nested packages, and need no changes.
