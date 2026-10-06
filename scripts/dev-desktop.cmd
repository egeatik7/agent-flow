@echo off
rem Runs Nubbo's own real-desktop test suite in its own console.
rem
rem Why this exists: started straight from an agent shell, the Electron test process dies with the
rem caller's console (0x80000003) and writes nothing. A detached console keeps it alive, and the
rem suite already writes its verdict to out\windows-desktop\summary.json, so the caller can read
rem the result from the file instead of from a window it cannot see.
cd /d "%~dp0.."
set ELECTRON_RUN_AS_NODE=
if not exist out mkdir out
if exist out\windows-desktop\summary.json del out\windows-desktop\summary.json
echo [%TIME%] desktop testi baslatiliyor > out\desktop-log.txt
start "" /min cmd /c "node scripts\run-windows-desktop.cjs >> out\desktop-log.txt 2>&1"
echo [%TIME%] ayri konsolda baslatildi; sonuc: out\windows-desktop\summary.json
