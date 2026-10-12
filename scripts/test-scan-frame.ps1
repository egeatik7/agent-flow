# Measures WHICH evidence inside Invoke-Scan belongs to the SAME frame as the picture the model gets.
# No screen is captured and no window is touched: the worker's function definitions are loaded from the
# AST (top-level Add-Type code is not run) and the capture/OCR/JPEG calls are replaced by stubs that
# record call ORDER and object IDENTITY. ASCII-only text is deliberate: a PS 5.1 harness must not depend
# on the console encoding. Turkish user-facing strings live in the worker, not here.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$screen = Join-Path $PSScriptRoot '../a11y/screen.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $screen), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $f.Extent.Text
}
function Check($condition, $message) { if (-not $condition) { throw $message } }

$script:olay = New-Object System.Collections.ArrayList
$script:kare = $null      # the bitmap Capture-Raw returned: THE frame
$script:kopya = $null     # the copy the JPEG encoder receives
function Olay($ad) { [void]$script:olay.Add($ad) }

# ---- stubs: later definitions win over the loaded ones ----
function Get-CaptureRect($win) { return [pscustomobject]@{ x = 0; y = 0; w = 120; h = 60 } }
function Find-WindowOrNull($t) { return $null }
function Get-TopWindows($pid) { return @() }
function Test-UsableWindow($w) { return $true }
function Enter-Window($w) { }
function Get-ScanRoots($win, $own, $fresh) { return @() }
function Get-UiaItems($roots, $area) {
  Olay 'uia'
  $l = New-Object System.Collections.ArrayList
  [void]$l.Add([pscustomobject]@{ id = 1; text = 'UIA item'; type = 'Text'; src = 'uia'; x = 5; y = 6; w = 20; h = 10 })
  # Comma keeps the ArrayList intact: returning it plainly would unroll to one object and .Count would vanish.
  return ,$l
}
function Capture-Raw($rect) {
  Olay 'capture'
  $script:kare = New-Object System.Drawing.Bitmap 120, 60, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  return $script:kare
}
function Set-BitmapOpaque($bmp) { }
function Copy-Bitmap32($bmp) {
  Olay ('copy/same-frame=' + [object]::ReferenceEquals($bmp, $script:kare))
  $script:kopya = New-Object System.Drawing.Bitmap 120, 60, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  return $script:kopya
}
function Initialize-Ocr() { return $true }
function Get-OcrPhrases($bmp, $ox, $oy, $exact = $false) {
  Olay ('win-ocr/same-frame=' + [object]::ReferenceEquals($bmp, $script:kare))
  $l = New-Object System.Collections.ArrayList
  [void]$l.Add([pscustomobject]@{ id = 2; text = 'OCR item'; type = 'Text'; src = 'ocr'; x = 30; y = 6; w = 20; h = 10 })
  return ,$l
}
function Save-OnnxShot($bmp) {
  Olay ('onnx-shot/same-frame=' + [object]::ReferenceEquals($bmp, $script:kare))
  return 'stub-onshot.raw'
}
function Get-TiltedPhrases($bmp, $ox, $oy, $horizontal) { Olay 'tilt'; return @() }
function Merge-Items($uia, $ocr) {
  Olay 'merge'
  $l = New-Object System.Collections.ArrayList
  foreach ($i in @($uia)) { [void]$l.Add($i) }
  foreach ($i in @($ocr)) { [void]$l.Add($i) }
  return $l
}
function Add-CursorMarker($bmp, $rect) { Olay 'cursor' }
function Get-TaskbarRegions() { return @() }
function ConvertTo-JpegBase64($bmp, $items, $rect, $marks, $maxW, $snap = 0, $fit = $false) {
  Olay ('jpeg/copy-of-frame=' + [object]::ReferenceEquals($bmp, $script:kopya) + '/marks=' + $marks + '/items=' + @($items).Count)
  return [pscustomobject]@{ path = 'stub.jpg'; data = 'STUB'; w = 120; h = 60; mime = 'image/jpeg' }
}

function Tara($image) {
  $script:olay = New-Object System.Collections.ArrayList
  $script:kare = $null; $script:kopya = $null
  $P = [pscustomobject]@{
    windowTitle = ''; strictWindow = ''; image = $image; maxImageW = 1400; ownPid = 1; uia = $true; ocr = $true
    fresh = $false; primary = $false; snap = 0; fit = $false; sig = $false; cursorMarker = $false; tilt = $true
    valueLo = $null; valueHi = $null; readOnly = $true
  }
  return (Invoke-Scan $P)
}
function Var($ad) { return @($script:olay | Where-Object { $_ -eq $ad }).Count }

# ---- 1) the marked picture the model gets: ONE frame, captured before every reader ----
$r = Tara 'marked'
$o = [string[]]$script:olay
Check ($o[0] -eq 'capture') "The frame must be captured FIRST (1.9.106): got '$($o[0])'"
Check ($o[1] -eq 'uia') "The UIA read must come after the frame now: got '$($o[1])'"
Check ((Var 'capture') -eq 1) 'A marked scan must capture exactly ONE frame (no second capture between OCR and picture).'
Check ($o -contains 'win-ocr/same-frame=True') 'Windows OCR must run on the captured frame itself.'
Check ($o -contains 'onnx-shot/same-frame=True') 'The ONNX raw shot must be saved from the captured frame.'
Check ($o -contains 'copy/same-frame=True') 'The picture handed to the window must be a copy of the captured frame.'
Check ($o -contains 'jpeg/copy-of-frame=True/marks=True/items=2') 'The marked picture must be encoded from that copy with BOTH items (UIA + OCR) drawn on it.'
Check ($r.image.data -eq 'STUB') 'The scan must return the produced picture.'
Write-Host ("r-type=" + $r.GetType().Name + " uia=" + $r.uiaCount + " ocr=" + $r.ocrCount + " items=" + @($r.items).Count)
Check ($r.uiaCount -eq 1) "UIA count must be 1 in the same scan result, got '$($r.uiaCount)'"
Check ($r.ocrCount -eq 1) "OCR count must be 1 in the same scan result, got '$($r.ocrCount)'"
# The budget lives in top-level code, which the AST loader deliberately skips: read it from the source
# text and say so. It bounds how long the reader list may lag behind the frame (measured: 200-400 ms
# whole desktop, ~70 ms per window - see scripts/measure-uia.ps1).
$budget = [regex]::Match((Get-Content -LiteralPath (Resolve-Path $screen) -Raw), '\$script:UiaBudgetMs\s*=\s*(\d+)')
Check ($budget.Success -and [int]$budget.Groups[1].Value -eq 6000) 'screen.ps1 must declare the 6000 ms UIA budget: that is the worst-case lag this harness reports.'

# ---- 2) a scan that asks for no picture must still capture once and produce no JPEG ----
$r2 = Tara 'none'
$o2 = [string[]]$script:olay
Check ((Var 'capture') -eq 1) 'Even without a picture the frame is captured once.'
Check (-not ($o2 -contains 'copy/same-frame=True')) 'Without a picture no copy is made.'
Check (@($o2 | Where-Object { $_ -like 'jpeg*' }).Count -eq 0) 'Without a picture no JPEG is produced.'
Check ($null -eq $r2.image) 'A none scan returns no picture.'

Write-Host 'PASS scan frame: the frame is captured FIRST, then UIA is read (the list is fresher than the picture);'
Write-Host 'Windows OCR, the ONNX raw shot and the marked picture all come from that one captured frame.'
