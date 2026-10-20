# Set-BitmapOpaque: gerçek fonksiyon, sahte bitmap'ler. Ekran yakalanmaz.
# Kapsam: 1.9.165'te eklenen "örnek üç nokta" hızlı yolu PowerShell'de `Object[] op_Multiply`
# üretip TÜM ekran okumalarını çökertiyordu; bu harness boyut/stride sınırlarını ve RGB korunmasını ölçer.
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

function New-TestBitmap([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = [int]$bd.Stride
    $bytes = New-Object byte[] ($stride * $h)
    for ($y = 0; $y -lt $h; $y++) {
      for ($x = 0; $x -lt $w; $x++) {
        $o = $y * $stride + $x * 4
        $bytes[$o] = [byte](($x * 7 + $y * 13) % 256)     # B
        $bytes[$o + 1] = [byte](($x * 3 + $y * 5) % 256)   # G
        $bytes[$o + 2] = [byte](($x + $y * 2) % 256)       # R
        $bytes[$o + 3] = 0                                  # BitBlt'in bıraktığı alfa
      }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
  } finally { $bmp.UnlockBits($bd) }
  return $bmp
}

function Read-Pixel($bmp, [int]$x, [int]$y) {
  $c = $bmp.GetPixel($x, $y)
  return @{ A = $c.A; R = $c.R; G = $c.G; B = $c.B }
}

$sizes = @(@(1, 1), @(4, 1), @(1, 3), @(1920, 1080), @(1920, 1082))  # tek/çift stride, 1080p ve tek satır fazlası
foreach ($size in $sizes) {
  $w = [int]$size[0]; $h = [int]$size[1]
  $bmp = New-TestBitmap $w $h
  try {
    $before = Read-Pixel $bmp 0 0
    Set-BitmapOpaque $bmp
    Check ($bmp.PixelFormat -eq [System.Drawing.Imaging.PixelFormat]::Format32bppArgb) "format değişti ${w}x${h}"
    foreach ($p in @(@(0, 0), @(($w - 1), 0), @(0, ($h - 1)), @(($w - 1), ($h - 1)))) {
      $px = Read-Pixel $bmp $p[0] $p[1]
      Check ($px.A -eq 255) "alfa 255 değil: ${w}x${h} @$($p[0]),$($p[1]) = $($px.A)"
    }
    $after = Read-Pixel $bmp 0 0
    Check ($after.R -eq $before.R -and $after.G -eq $before.G -and $after.B -eq $before.B) "RGB bozuldu: ${w}x${h}"
  } finally { $bmp.Dispose() }
  Write-Host ("OK {0}x{1}" -f $w, $h)
}

# Zaten opak bitmap hızlı yolda erken döner ve yeniden döngü yapmaz (süre ölçülmez, davranış ölçülür).
$opaque = New-Object System.Drawing.Bitmap 64, 64, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
try {
  $g = [System.Drawing.Graphics]::FromImage($opaque)
  try { $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 20, 30)) } finally { $g.Dispose() }
  Set-BitmapOpaque $opaque
  $px = Read-Pixel $opaque 0 0
  Check ($px.A -eq 255 -and $px.R -eq 10 -and $px.G -eq 20 -and $px.B -eq 30) "opak bitmap değişti"
} finally { $opaque.Dispose() }

# Alfa 32 dışı bitmap'e dokunulmaz (dönüşüm başka yerde).
$rgb = New-Object System.Drawing.Bitmap 8, 8, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
try { Set-BitmapOpaque $rgb; Check ($rgb.PixelFormat -eq [System.Drawing.Imaging.PixelFormat]::Format24bppRgb) '24bpp format değişti' } finally { $rgb.Dispose() }

Write-Host 'PASS: Set-BitmapOpaque 1x1/4x1/1x3/1080p/1082 satırda alfa 255, RGB korunur; opak ve 24bpp bitmap değişmez.'
