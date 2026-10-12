# Measures how much the UIA tree actually MOVES during the capture: UIA read -> frame capture -> UIA
# read again, then compares element rectangles. Read-only: no input, no window is touched.
# The point: the capture and the UIA walk cannot share one instant (a walk is a span, not a tick), so the
# useful question is how much the tree drifts across that span ON THIS MACHINE.
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

$pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$wins = @()
try { $wins = @(Get-TopWindows 0 | Where-Object { Test-UsableWindow $_ }) } catch { $wins = @() }
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
Write-Host ("windows=" + $wins.Count + " area=" + $area.w + "x" + $area.h)

function Oku() {
  $roots = Get-ScanRoots $null 0 $false
  return Get-UiaItems $roots $area
}
function Anahtar($i) { return ("" + $i.text + '|' + $i.type + '|' + $i.aid) }

for ($tur = 1; $tur -le 2; $tur++) {
  $a = Sure { Oku }
  $c = Sure { Capture-Raw ([pscustomobject]@{ x = [int]$pb.X; y = [int]$pb.Y; w = [int]$pb.Width; h = [int]$pb.Height }) }
  if ($null -ne $c.value) { $c.value.Dispose() }
  $b = Sure { Oku }

  $onceki = @{}
  foreach ($i in @($a.value)) {
    $k = Anahtar $i
    if (-not $onceki.ContainsKey($k)) { $onceki[$k] = New-Object System.Collections.ArrayList }
    [void]$onceki[$k].Add($i)
  }
  $karsilastirilan = 0; $kayan = 0; $enBuyuk = 0; $toplam = 0
  foreach ($j in @($b.value)) {
    $k = Anahtar $j
    if (-not $onceki.ContainsKey($k) -or $onceki[$k].Count -eq 0) { continue }
    $i = $onceki[$k][0]
    $onceki[$k].RemoveAt(0)
    $karsilastirilan++
    $d = [Math]::Max([Math]::Abs([int]$j.x - [int]$i.x), [Math]::Abs([int]$j.y - [int]$i.y))
    $d = [Math]::Max($d, [Math]::Max([Math]::Abs([int]$j.w - [int]$i.w), [Math]::Abs([int]$j.h - [int]$i.h)))
    $toplam += $d
    if ($d -gt $enBuyuk) { $enBuyuk = $d }
    if ($d -gt 2) { $kayan++ }
  }
  $ort = 0
  if ($karsilastirilan -gt 0) { $ort = [Math]::Round($toplam / $karsilastirilan, 1) }
  Write-Host ("round " + $tur + ": UIA1=" + $a.ms + " ms (" + @($a.value).Count + " items) capture=" + $c.ms + " ms UIA2=" + $b.ms + " ms (" + @($b.value).Count + " items)")
  Write-Host ("   compared=" + $karsilastirilan + " moved>2px=" + $kayan + " maxDelta=" + $enBuyuk + " px meanDelta=" + $ort + " px  || span between the two reads = " + ($a.ms + $c.ms + $b.ms) + " ms")
}

Write-Host 'NOTE: capture and UIA cannot share one instant: the UIA read is a traversal (a span), and the'
Write-Host 'frame is one BitBlt. The number that matters is how much the tree moves inside that span.'
