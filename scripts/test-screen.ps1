# Runs the real ConvertTo-JpegBase64 on blank bitmaps the size of screens at several display scales.
# No screen is captured and no window is touched.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$screen = Join-Path $PSScriptRoot '../a11y/screen.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $screen), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Load the function definitions only; the top-level code of screen.ps1 (Add-Type blocks) is not run.
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $f.Extent.Text
}
function Check($condition, $message) { if (-not $condition) { throw $message } }
function Shot($w, $h, $marks, $maxW, $snap, $fit) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $rect = [pscustomobject]@{ x = 0; y = 0; w = $w; h = $h }
  try { return (ConvertTo-JpegBase64 $bmp (New-Object System.Collections.ArrayList) $rect $marks $maxW $snap $fit) }
  finally { $bmp.Dispose() }
}
$made = New-Object System.Collections.ArrayList
function Run($w, $h, $maxW, $snap, $fit) {
  $r = Shot $w $h $false $maxW $snap $fit
  [void]$made.Add($r.path)
  return $r
}

# The same 1080p desktop at 100%, 125%, 150% and 200% display scale is 1920, 2400, 2880 and 3840 pixels wide.
$screens = @(@(1920, 1080), @(2400, 1350), @(2880, 1620), @(3840, 2160))

# What UI-TARS gets: under one megapixel, a multiple of 28, and the SAME size whatever the display scale.
foreach ($s in $screens) {
  $r = Run $s[0] $s[1] 1288 28 $true
  Check ($r.w -eq 1288 -and $r.h -eq 728) "A $($s[0])x$($s[1]) screen must reach the model as 1288x728, not $($r.w)x$($r.h)"
  Check ($r.w % 28 -eq 0 -and $r.h % 28 -eq 0) 'The picture size must be a multiple of 28'
  Check (($r.w * $r.h) -lt 1000000) 'The picture must stay under one megapixel'
  Check ($r.mime -eq 'image/jpeg' -and (Test-Path $r.path)) 'A fitted picture is a JPEG file'
}

# Other models: the width cap applies, no snapping.
$r = Run 2880 1620 1400 0 $true
Check ($r.w -eq 1400 -and $r.h -eq 788) "A non-TARS shot of a 2880x1620 screen is capped at 1400 wide (got $($r.w)x$($r.h))"

# The scanner preview (no fit) is unchanged: full size PNG, the real pixel size.
foreach ($s in $screens) {
  $r = Run $s[0] $s[1] 1600 0 $false
  Check ($r.w -eq $s[0] -and $r.h -eq $s[1] -and $r.mime -eq 'image/png') "A plain picture without fit stays $($s[0])x$($s[1]) PNG for the scanner preview"
}

# A marked picture (with boxes) is scaled as before.
$r = Shot 2880 1620 $true 1400 0 $false
[void]$made.Add($r.path)
Check ($r.w -eq 1400 -and $r.mime -eq 'image/jpeg') 'A marked picture is still scaled to the width cap'

foreach ($p in $made) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
Write-Output 'PASS: model pictures have the same size at 100/125/150/200% display scale; scanner preview and marked pictures unchanged.'
