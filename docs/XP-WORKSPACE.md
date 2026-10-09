# XP workspace update

## Interface
- XP is the only skin. Aero styles, theme switching, mascot/logo variants and assets were removed. The original animated XP mascot is retained.
- An empty workspace offers Tuval Aç, Otomasyon Aç and Yeni Tuval Oluştur, with XP-style SVG icons. The first two open catalog pickers; empty catalogs explain where to create an item. An empty automation cannot be opened.
- The mascot, logo and version sit at the bottom of Tuvaller. The catalog above them scrolls independently. On narrow screens the brand scales proportionally to leave room for the catalog.
- Clicking empty canvas space restores the Node hierarchy. Every node appears, including disconnected nodes, nested packages and loops. Explicit frame membership takes priority; loop-return paths also appear inside the relevant loop for older graphs. This inferred grouping only affects the list and never changes saved memberships or edges.
- Folder toggles and Expand All / Collapse All open and close the hierarchy. Expansion state survives inspecting a node on the same canvas. Clicking a row opens its package path, selects the node and centers it. Navigation writes any currently edited package view back into its parent in memory so unsaved edits survive moving between packages.
- XP scrollbars have up/down and left/right arrow artwork, one button at each end. Tuval tabs only scroll horizontally, preventing a stray vertical scrollbar at the former OCR/theme area. Unused OCR-picker styles and its obsolete help entry were removed; OCR operation remains available through Ekran Tarayıcı.

## Persistence
The preceding canvas/session update remains: empty startup, review each modified canvas on close, Save/Discard/Cancel, and automatic persistence of automation container lists. Execution, OCR, LLM and input-engine behavior were not changed by this XP workspace update.

## Validation
- 508 tests passed, 5 skipped (67 test files passed, 1 skipped).
- TypeScript checks and renderer/main production builds passed.
- Real React DOM tests cover both welcome pickers, new canvas creation, nested package navigation, exact centering of a distant node, tree state retention, blank-click restoration and brand placement.
- Pure graph tests cover disconnected nodes, nested loops, loop-return edges, cyclic/malformed memberships, scoped IDs and no graph mutation.
- Existing run/stop, close review, save failure and automation persistence tests pass.
- Native Windows EXE appearance and scrollbar arrow interaction have not been visually verified in this environment. No browser binary was available; the browser download failed, so no new screenshots are claimed.

## Building on Windows
Install Node.js, open a terminal in the extracted agent-flow folder, then run:

```powershell
npm ci
npm run pack:win
```

The portable executable is release/Nubbo.exe. This delivery contains source code and patches, not a prebuilt Windows executable.

## Patch bases
- agent-flow-cumulative.patch applies to base main 6edcdcc8424ac002be1ffb15ae7dd5daff024c8f and includes earlier canvas save/session work.
- agent-flow-update.patch applies to 4cedcea, the last completed Aero/canvas-save revision.
- agent-flow-from-checkpoint.patch applies to c826830, the paused checkpoint.
Apply only the patch matching your current source, or use the complete source folder. Local branch name codex/lilac-aero-reskin is historical; no Aero implementation remains in the shipped source.
