# Measures how long the read-only UIA walk takes NEXT TO a screen capture on this machine.
# Read-only: no input is sent, no window is touched, no click is made. The app's own load path is used
# (worker.ps1 dot-sources these two files), so the numbers come from the real functions.
# ASCII-only output on purpose: a PS 5.1 harness must not depend on the console encoding.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot '../a11y/common.ps1')
. (Join-Path $PSScriptRoot '../a11y/screen.ps1')

function Sure($blok) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $sonuc = & $blok
  $sw.Stop()
  return [pscustomobject]@{ ms = $sw.ElapsedMilliseconds; value = $sonuc }
}

$vs = Get-VirtualScreen
Write-Host ("virtual screen from worker: " + $vs.X + "," + $vs.Y + " " + $vs.Width + "x" + $vs.Height)
$pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Host ("primary screen from WinForms: " + $pb.X + "," + $pb.Y + " " + $pb.Width + "x" + $pb.Height)

$wins = @()
try { $wins = @(Get-TopWindows 0 | Where-Object { Test-UsableWindow $_ }) } catch { $wins = @() }
Write-Host ("usable top windows: " + $wins.Count)

# The area the walk is bounded by: the union of real window rectangles, so a session without a display
# surface still measures the REAL element tree instead of an empty zero-size rectangle.
$minX = [int]::MaxValue; $minY = [int]::MaxValue; $maxX = [int]::MinValue; $maxY = [int]::MinValue
foreach ($w in $wins) {
  try {
    $r = $w.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { continue }
    $minX = [Math]::Min($minX, [int]$r.Left); $minY = [Math]::Min($minY, [int]$r.Top)
    $maxX = [Math]::Max($maxX, [int]$r.Right); $maxY = [Math]::Max($maxY, [int]$r.Bottom)
  } catch { }
}
if ($minX -eq [int]::MaxValue) { $minX = 0; $minY = 0; $maxX = [int]$pb.Width; $maxY = [int]$pb.Height }
$area = [pscustomobject]@{ x = $minX; y = $minY; w = [Math]::Max(1, $maxX - $minX); h = [Math]::Max(1, $maxY - $minY) }
Write-Host ("UIA area (union of windows): " + $area.x + "," + $area.y + " " + $area.w + "x" + $area.h)

for ($i = 1; $i -le 3; $i++) {
  $r1 = Sure { Get-ScanRoots $null 0 $false }
  $r2 = Sure { Get-UiaItems $r1.value $area }
  Write-Host ("round " + $i + ": roots(windows)=" + $r1.ms + " ms | UIA walk=" + $r2.ms + " ms (" + @($r2.value).Count + " items) || UIA-vs-frame gap today = " + ($r1.ms + $r2.ms) + " ms")
}

if ($wins.Count -gt 0) {
  $one = $wins[0]
  $ad = "" + $one.Current.Name
  if ($ad.Length -gt 40) { $ad = $ad.Substring(0, 40) }
  $r1 = Sure { Get-ScanRoots $one 0 $false }
  $r2 = Sure { Get-UiaItems $r1.value $area }
  Write-Host ("single window '" + $ad + "': roots=" + $r1.ms + " ms | UIA walk=" + $r2.ms + " ms (" + @($r2.value).Count + " items)")
}

# The frame itself. The worker's virtual screen can report 0x0 in a session without a display surface,
# so fall back to the primary screen bounds WinForms reports: the number we want is the capture cost.
$capRect = $null
if ($vs.Width -gt 0 -and $vs.Height -gt 0) {
  $capRect = [pscustomobject]@{ x = [int]$vs.X; y = [int]$vs.Y; w = [int]$vs.Width; h = [int]$vs.Height }
  Write-Host 'frame rect source: worker virtual screen'
} elseif ($pb.Width -gt 0 -and $pb.Height -gt 0) {
  $capRect = [pscustomobject]@{ x = [int]$pb.X; y = [int]$pb.Y; w = [int]$pb.Width; h = [int]$pb.Height }
  Write-Host 'frame rect source: WinForms primary screen (worker reports 0x0)'
}
if ($null -ne $capRect) {
  for ($i = 1; $i -le 3; $i++) {
    $r3 = Sure { Capture-Raw $capRect }
    if ($null -ne $r3.value) { $r3.value.Dispose() }
    Write-Host ("frame capture round " + $i + " = " + $r3.ms + " ms")
  }
} else {
  Write-Host 'frame capture: NOT measurable in this session (no display surface at all).'
}

Write-Host 'NOTE: the gap between the UIA read and the frame is the UIA walk duration itself; swapping the'
Write-Host 'order does not remove that gap, it only decides which of the two is the older one.'
