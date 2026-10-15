# Windows-only: exercise the REAL production image encoder using synthetic bitmaps.
# No desktop capture, mouse movement, click, API key or model is used.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\a11y\common.ps1')
. (Join-Path $PSScriptRoot '..\a11y\screen.ps1')
$cases = @(
  @(3840,2160,1920,1080), @(2560,1440,1920,1080), @(1920,1080,1920,1080),
  @(1920,1200,1728,1080), @(1080,1920,608,1080), @(1280,720,1280,720)
)
foreach ($case in $cases) {
  $bmp = New-Object System.Drawing.Bitmap ([int]$case[0]), ([int]$case[1])
  $img = $null
  try {
    $area = [pscustomobject]@{x=-1920;y=-200;w=$case[0];h=$case[1]}
    $img = ConvertTo-JpegBase64 $bmp (New-Object System.Collections.ArrayList) $area $false 1920 0 $true 1080
    if ($img.w -ne $case[2] -or $img.h -ne $case[3]) { throw "Wrong image size: $($case[0])x$($case[1]) -> $($img.w)x$($img.h)" }
    $encoded = [System.Drawing.Image]::FromFile($img.path)
    try { if ($encoded.Width -ne $img.w -or $encoded.Height -ne $img.h) { throw 'Encoded image dimensions disagree with metadata' } }
    finally { $encoded.Dispose() }
    Write-Host "PASS $($case[0])x$($case[1]) -> $($img.w)x$($img.h)"
  } finally {
    $bmp.Dispose()
    if ($null -ne $img -and $img.path) { Remove-Item -LiteralPath $img.path -Force }
  }
}
