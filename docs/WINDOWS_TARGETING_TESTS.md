# Nubbo: Windows targeting tests and click evidence

The user still builds the same existing nodes with simple commands. This work adds developer diagnostics and tests, not new node kinds, flow migrations, or new completion rules. Normal runs do not record target screenshots. The existing screen-transition policy is unchanged.

## What each result proves

| Layer | Actual implementation | Boundary | What passing means |
| --- | --- | --- | --- |
| Existing Node/Vitest/PowerShell tests | Production TypeScript and extracted worker functions | Mock OS/model input | The covered decision and protocol rules hold |
| `test:targeting` | Production target resolver | Recorded screen candidates and parsed model answers | Matching, coordinate mapping, and replay work for those observations |
| `test:desktop` | Actual Electron, actual `a11y-bridge`, actual PowerShell worker, native mouse/keyboard, actual Windows UIA and OCR | A visible test application with known controls | The expected control actually received input |
| Opt-in live models | Same production resolver and actual desktop | Explicit OpenRouter text/GUI model | The live model chose and physically activated the expected target in the tested cases |

A sent click is logged as `input.phase: sent`, not as proof that the target activated. The visible test app records independent `MouseDown`, `Click`, text-change, and key events. Expected rectangles are used for assertions; they are not passed to the resolver as target answers. The duplicate-caption test supplies an anchor just as a user who picked a target would; it still requires fresh candidate matching and a real physical click.

Most desktop cases pass a synthetic condition as `StepAhead` to isolate targeting/input from the existing screen-transition heuristic. No such node is added to user flows. A separate `runGraph` test exercises a normal Start → Click → End graph and the existing post-action path.

## GitHub Actions

Workflow: `.github/workflows/windows-targeting.yml`.

The initial feature-branch push runs only the small Windows desktop probe. Full suites run on a PR/main/manual execution only after that probe passes. `probe-passed` proves environment capability, not target-selection accuracy. To run just that probe locally, set `NUBBO_PROBE_ONLY=1` before `npm run test:desktop`.

- Windows Server 2022 and 2025 jobs run typechecks, existing regression tests, and new targeting tests.
- Worker mock tests run under both Windows PowerShell 5.1 and PowerShell 7. Running those scripts on Windows does not turn their mocked input into native input.
- Desktop tests compile `scripts/windows/ClickTestHost.cs` into a temporary visible WinForms application, then launch the real Electron test entry at `desktop-test.cjs`.
- The desktop probe checks input-desktop access, a nonblank real capture, and reception of one actual native mouse click. This probe uses a known fixture point only to establish environment capability; it is not counted as target-selection accuracy.
- Exit 0 = all required cases passed. Exit 1 = test failure. Exit 2 = required environment/capability unavailable. A blocked case makes the desktop job unsuccessful; it is never counted as a passed test.
- Evidence uploads use `if: always()` so failed runs can be diagnosed. The GitHub job summary lists individual passed/failed/blocked cases and coverage limits.
- A portable `release/Nubbo.exe` is built on Windows 2022 only after the preceding checks pass. The artifact `Nubbo-tested-windows-x64` contains the EXE and SHA256. A failed desktop run does not yield a "tested EXE" artifact.
- The CI job has a finite cleanup limit. This does not change production timers or addon-waiting behavior.

The test application is independent of Electron. It has two identical `Kaydet` buttons, a unique `Devam` button, a disabled button, separate source/search fields, a competing window, an occluding window, and painted `RUN REMESH` text that is not exposed as a UIA caption. The latter tests real OCR against a custom-rendered interface.

Cases cover fresh matching, duplicate captions, movement, resizing, larger controls, inactive-window selection, read-only preview, disabled UIA controls, label-to-field typing, one Enter, the real bound-window guard, 12 repeat executions, actual Windows OCR, bundled ONNX recognition, and an ordinary production graph.

### Explicit coverage limits

The 125/150% cases enlarge the fixture's controls and fonts. They **do not change Windows display DPI**. Actual DPI and monitor bounds are saved in `summary.json`. Negative origins and image-size transforms are also covered by offline coordinate tests; that is not a physical multi-monitor test.

The fixture does not prove Blender addon correctness, Tkinter custom widget behavior, browser-profile switching, hours-long processing, or Win+R/D/E/Tab/Shift+S shell effects. Those require additional real application/environment cases. The test fixture's standard controls do not substitute for Blender's rendered UI.

ONNX has an explicit standalone scan using `ocrEngine: onnx` with UIA disabled. That scan must contain accepted ONNX text and a target box inside the independently known painted button. The production `onnx` fallback stage can retain valid Windows OCR rows by design; its combined scan alone would not prove the ONNX engine recognized the text.

## Run locally on Windows

Use a normal unlocked Windows desktop, with other automation stopped while native tests run. The fixture is visible so a human can inspect each stage.

```powershell
npm ci
npm run test:targeting
npm run test:desktop
```

Output: `out/windows-desktop/summary.json`, `agent-log.json`, probe capture, fixture state, and `evidence/` with original captures, `.trace.json` bundles, and annotated `.overlay.svg` files. Open an SVG in a browser to see candidates in blue, the selected rectangle in red, and the selected point marked with a cross.

The runner terminates its own worker and fixture in cleanup. Starting it from Linux records `environment-blocked` and exits 2; it does not run a demo backend and call that a native pass.

## Diagnose an actual application

This uses the same production resolver and emits no mouse or keyboard input by default:

```powershell
npm run diagnose:click -- --window "Blender" --prompt '“Run Remesh”' --stages windows,onnx
```

Preview sets `readOnly` on UIA lookup and screen scanning, so the selected window is not brought forward. An occluded/minimized window may not be visually readable in preview; the recorded image reflects the visible desktop. This is one resolution attempt, without recovery actions or memory writes.

To explicitly send one real click:

```powershell
npm run diagnose:click -- --window "Nubbo Click Test Host" --prompt '“Devam”' --stages windows --click
```

`--output` chooses an evidence directory; default is `out/click-diagnostics`. A diagnostic click records input dispatch but cannot independently prove activation in an arbitrary external application. Only the fixture's event oracle makes that assertion in the desktop tests.

The resolver hook is `AgentContext.onTargetTrace`, with optional `captureTargetImages`. It records effective instruction/order/memory, candidate observations, selected geometry, parsed model answers (raw action text is available for GUI answers), and native-dispatch points. It never serializes the settings object or API key. Observer input is cloned; observer mutations/errors cannot change a target. Diagnostic screenshots are kept separate from the list model's normal image inputs. The recorder keeps at most 80 attempts per recorder instance; each new run gets its own filename prefix. Old runs can be deleted as a directory. Production screenshot recording remains opt-in.

## Replay a captured failure

```powershell
npm run replay:target -- "out\click-diagnostics\example.trace.json"
```

Keep associated frame files beside the JSON. Replay executes the real compiled resolver in read-only mode with recorded OS observations and recorded parsed model answers. It throws if an input operation is attempted. It does not contact OpenRouter. A reproduced point means the decision was reproduced, not that the point was correct. Accuracy assertions need an independently specified expected target.

Replay requires a complete single-attempt trace for the stages used. Failed OS calls without recorded responses, Windows HWND validation, live focus changes, and real OCR recognition cannot be reconstructed from candidate lists. An incomplete trace is reported as incomplete instead of inventing an observation.

## Optional live model tests

No API key is needed for the default workflow. To measure live model decisions, store `NUBBO_TEST_API_KEY` in repository Actions secrets, then run the workflow manually with `live_models` enabled and explicit `text_model` / `gui_model` IDs. The separate live job receives the secret; the normal PR and push jobs do not. Model tests can make extra requests during the existing bounded lookup/recovery behavior; enabling them is an explicit paid test request.

Locally, set the same environment variables using your normal secret handling, plus `NUBBO_RUN_LIVE_MODELS=1`, then run `npm run test:desktop`. Do not paste an API key into a node, source file, command-line argument, or trace. The text test receives the actual scanned candidate list; the GUI test receives the actual screenshot. Neither receives the fixture's expected button coordinates.

## Baseline and compatibility

Started from PR #2 commit `cf2e237d668307ce01b1f112cf8bc21cae09cadd`. Existing flow JSON, node names, key strings, UI design, target-stage ordering, and recovery limits stay unchanged. The old Enter Vitest fixture gained the missing window-identity bridge methods so the Windows branch can be exercised.
