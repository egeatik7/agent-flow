# XP workspace and canvas navigator

## Interface
- XP is the only skin. Aero and the theme switch were removed.
- An empty workspace offers Tuval Aç, Otomasyon Aç and Yeni Tuval Oluştur. The first two use saved-item pickers with XP-style icons.
- The original mascot, logo and version sit at the bottom of Tuvaller, with an independently scrolling catalog above.
- Node is a current-scope navigator rather than an expandable tree. Entering a package replaces the list with that package’s nodes. Loops, their members, return-path nodes and disconnected nodes remain individually reachable in the current scope.
- Single click on a regular node centers it and clears selection; double click centers and selects it, opening its settings below the list. Single click on a package enters it without selection; double click opens the package’s own settings in its parent view. Package single clicks wait 300 ms to distinguish them from double clicks without the second click hitting a new child row. Keyboard Enter enters immediately; Ctrl+Enter opens settings.
- Back and Forward follow visited node/package locations. Out exits one package and centers its wrapper without selecting it. History resets when switching canvases, skips removed destinations and cuts the forward branch after a new visit. Unsaved package edits survive all these moves.
- Navigation stays available during a run. Settings/data-changing controls stay disabled. The visible current leaf and containing packages/loops pulse blue while running, amber when stopped and red for error. Stale running markers disappear after a completed run.
- Tuval hiyerarşisi, Expand All and Collapse All controls are removed.
- XP scrollbars retain their directional arrow artwork, and the tuval tabs only scroll horizontally.

## OCR settings
- The two reader-labelled target matching stages are merged into one Windows + ONNX OCR stage. The resolver no longer repeats the same combined target search.
- Old saved Windows/ONNX stage IDs are migrated into one row. If either old stage was enabled, combined direct matching stays enabled. If both were disabled, it stays disabled. The earliest enabled old OCR position is retained, including a model-before-OCR preference. Other disabled stages and custom prompts stay intact.
- The checkbox controls direct matching of a quoted target. It does not switch off OCR used to build the model’s word list; the UI explains this explicitly.
- Windows and ONNX recognition, pixel transforms and 90° counter-clockwise OCR scans are unchanged. The rotation only affects OCR copies, and boxes are mapped back to normal screen coordinates.
- Reset controls now use the declared default disabled-stage list consistently.

## Persistence
Empty startup, per-canvas Save/Discard/Cancel close review, automation container persistence, run/stop and failure recovery remain in place. Navigation state is transient; it is not written into node fields or saved canvas metadata.

## Validation
- 514 tests passed, 5 skipped (68 test files passed, 1 skipped).
- TypeScript checks and renderer/main production builds passed.
- Real React DOM tests cover pickers, new canvas creation, current-scope replacement, single/double clicks, exact centering, history/out actions and brand placement.
- Integration tests cover live/stopped sidebar markers, navigation during runs, unselected focus, empty package Start markers, canvas history reset, preservation of unsaved edits and existing execution/close review behavior.
- OCR migration tests cover legacy off/on combinations, retained ordering, one UI checkbox and old API stage IDs. Existing OCR geometry, condition-target and runner tests pass.
- Native Windows EXE appearance and scrollbar interaction have not been visually verified in this environment; no new screenshots are claimed.

## Building on Windows
Install Node.js, open a terminal in the extracted agent-flow folder, then run:

```powershell
npm ci
npm run pack:win
```

The portable executable is release/Nubbo.exe. This delivery contains source code and patches.

## Patch bases
- agent-flow-cumulative.patch applies to base main 6edcdcc8424ac002be1ffb15ae7dd5daff024c8f and includes earlier canvas save/session work.
- agent-flow-update.patch applies to a81705e, the preceding completed XP workspace delivery.
Apply only the patch matching your current source, or use the complete source folder.
