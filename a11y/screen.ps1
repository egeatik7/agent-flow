# Screen capture, Windows OCR and visible UI Automation scan.
# Requires common.ps1 to be dot-sourced first. All coordinates are physical screen pixels.

$script:OcrTried = $false
$script:OcrEngine = $null
# Extra engines for Chinese/Japanese/Korean when those OCR language packs are installed but not first in the profile.
$script:OcrExtra = New-Object System.Collections.ArrayList

function Initialize-Ocr {
  if ($script:OcrTried) { return ($null -ne $script:OcrEngine) }
  $script:OcrTried = $true
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $script:AsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
      })[0]
    $script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $script:OcrEngine) {
      $script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
    }
    $mainTag = ''
    if ($null -ne $script:OcrEngine) { $mainTag = [string]$script:OcrEngine.RecognizerLanguage.LanguageTag }
    foreach ($lang in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
      $tag = [string]$lang.LanguageTag
      if ($tag -eq $mainTag -or $tag -notmatch '^(zh|ja|ko)') { continue }
      if ($script:OcrExtra.Count -ge 2) { break }
      $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
      if ($null -ne $eng) { [void]$script:OcrExtra.Add($eng) }
    }
  } catch {
    $script:OcrEngine = $null
  }
  return ($null -ne $script:OcrEngine)
}

function Get-OcrInfo {
  $ok = Initialize-Ocr
  $avail = @()
  try { $avail = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { [string]$_.LanguageTag }) } catch {}
  $extra = @($script:OcrExtra | ForEach-Object { [string]$_.RecognizerLanguage.LanguageTag })
  $main = ''
  if ($ok) { $main = [string]$script:OcrEngine.RecognizerLanguage.LanguageTag }
  return [pscustomobject]@{ ok = $ok; main = $main; extra = $extra; available = $avail }
}

function Test-Cjk([string]$s) {
  return $s -match '[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]'
}

function Wait-WinRt($op, [type]$resultType) {
  $task = $script:AsTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  [void]$task.Wait(-1)
  return $task.Result
}

function Get-VirtualScreen {
  $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
  return [pscustomobject]@{ x = $v.X; y = $v.Y; w = $v.Width; h = $v.Height }
}

function Get-CaptureRect($win) {
  $v = Get-VirtualScreen
  if ($null -eq $win) { return $v }
  $r = $win.Current.BoundingRectangle
  $x1 = [Math]::Max($v.x, [int]$r.X)
  $y1 = [Math]::Max($v.y, [int]$r.Y)
  $x2 = [Math]::Min($v.x + $v.w, [int]($r.X + $r.Width))
  $y2 = [Math]::Min($v.y + $v.h, [int]($r.Y + $r.Height))
  if ($x2 - $x1 -lt 20 -or $y2 - $y1 -lt 20) { return $v }
  return [pscustomobject]@{ x = $x1; y = $y1; w = $x2 - $x1; h = $y2 - $y1 }
}

$script:HudHwnd = [IntPtr]::Zero

function Set-HudHandle($P) {
  $script:HudHwnd = [IntPtr]::Zero
  if ($null -eq $P) { return }
  $raw = ''
  try { $raw = [string]$P.hudHwnd } catch { return }
  if (-not $raw) { return }
  try { $script:HudHwnd = New-Object IntPtr ([int64]$raw) } catch { $script:HudHwnd = [IntPtr]::Zero }
}

# CopyFromScreen sees the tracking card. Hide that window for the grab, then put it back.
function Copy-Screen($rect) {
  $hwnd = $script:HudHwnd
  $hidden = $false
  if ($null -ne $hwnd -and $hwnd -ne [IntPtr]::Zero) {
    try {
      if ([XpNative]::IsWindowVisible($hwnd)) {
        [void][XpNative]::ShowWindow($hwnd, 0)
        $hidden = $true
        try { [void][XpNative]::DwmFlush() } catch {}
        Start-Sleep -Milliseconds 80
      }
    } catch {}
  }
  try {
    $bmp = New-Object System.Drawing.Bitmap ([int]$rect.w), ([int]$rect.h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$rect.x, [int]$rect.y, 0, 0, $bmp.Size)
    $g.Dispose()
    return $bmp
  } finally {
    if ($hidden) {
      try { [void][XpNative]::ShowWindow($hwnd, 4) } catch {}
    }
  }
}

function Get-ScreenBitmap($rect) {
  $bmp = Copy-Screen $rect
  # BitBlt leaves alpha at 0. A later draw then treats the whole shot as transparent and it comes out gray.
  Set-BitmapOpaque $bmp
  return $bmp
}

function Capture-Raw($rect) {
  return (Copy-Screen $rect)
}

function Set-BitmapOpaque($bmp) {
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  if ($bmp.PixelFormat -ne $fmt) { return }
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, $fmt)
  try {
    $stride = [int]$bd.Stride
    $n = $stride * $h
    $bytes = New-Object byte[] $n
    [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $n)
    for ($y = 0; $y -lt $h; $y++) {
      $row = $y * $stride
      for ($x = 0; $x -lt $w; $x++) { $bytes[$row + ($x * 4) + 3] = 255 }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $n)
  } finally {
    $bmp.UnlockBits($bd)
  }
}

# Pixel copy. DrawImage drops the picture when alpha is 0, which is what made Blender look gray.
function Copy-Bitmap32($bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $copy = New-Object System.Drawing.Bitmap $w, $h, $fmt
  $src = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $fmt)
  $dst = $copy.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $fmt)
  try {
    $ss = [int]$src.Stride
    $ds = [int]$dst.Stride
    $row = [Math]::Min($ss, $ds)
    $sbytes = New-Object byte[] ($ss * $h)
    $dbytes = New-Object byte[] ($ds * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($src.Scan0, $sbytes, 0, $sbytes.Length)
    for ($y = 0; $y -lt $h; $y++) {
      [System.Buffer]::BlockCopy($sbytes, ($y * $ss), $dbytes, ($y * $ds), $row)
    }
    [System.Runtime.InteropServices.Marshal]::Copy($dbytes, 0, $dst.Scan0, $dbytes.Length)
  } finally {
    $bmp.UnlockBits($src)
    $copy.UnlockBits($dst)
  }
  return $copy
}

if (-not ('XpTurn' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class XpTurn {
  // Quarter-turn counter-clockwise. Pixels are copied; RotateFlip and DrawImage are not used.
  public static Bitmap Ccw(Bitmap src) {
    int w = src.Width, h = src.Height;
    if (w < 1 || h < 1) return new Bitmap(1, 1, PixelFormat.Format32bppArgb);
    var srect = new Rectangle(0, 0, w, h);
    var sbd = src.LockBits(srect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var dst = new Bitmap(h, w, PixelFormat.Format32bppArgb);
    var drect = new Rectangle(0, 0, h, w);
    var dbd = dst.LockBits(drect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
    try {
      int ss = sbd.Stride, ds = dbd.Stride;
      var sbytes = new byte[ss * h];
      var dbytes = new byte[ds * w];
      Marshal.Copy(sbd.Scan0, sbytes, 0, sbytes.Length);
      for (int y = 0; y < h; y++) {
        int srow = y * ss;
        for (int x = 0; x < w; x++) {
          int rx = y;
          int ry = w - 1 - x;
          int si = srow + (x * 4);
          int di = ry * ds + (rx * 4);
          dbytes[di] = sbytes[si];
          dbytes[di + 1] = sbytes[si + 1];
          dbytes[di + 2] = sbytes[si + 2];
          dbytes[di + 3] = 255;
        }
      }
      Marshal.Copy(dbytes, 0, dbd.Scan0, dbytes.Length);
    } finally {
      src.UnlockBits(sbd);
      dst.UnlockBits(dbd);
    }
    return dst;
  }

  // Levels. lo and below become 0. hi and above become 1. The middle stretches. Hue stays.
  public static void CompressValue(Bitmap bmp, double lo, double hi) {
    if (lo < 0) lo = 0;
    if (hi > 1) hi = 1;
    if (hi < lo) { double swap = lo; lo = hi; hi = swap; }
    if (lo <= 0.0001 && hi >= 0.9999) return;
    int w = bmp.Width, h = bmp.Height;
    if (w < 1 || h < 1) return;
    var rect = new Rectangle(0, 0, w, h);
    var bd = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    try {
      int stride = bd.Stride;
      var bytes = new byte[stride * h];
      Marshal.Copy(bd.Scan0, bytes, 0, bytes.Length);
      double span = hi - lo;
      for (int y = 0; y < h; y++) {
        int row = y * stride;
        for (int x = 0; x < w; x++) {
          int i = row + (x * 4);
          int b = bytes[i];
          int g = bytes[i + 1];
          int r = bytes[i + 2];
          int max = r > g ? r : g;
          if (b > max) max = b;
          if (max == 0) continue;
          double v = max / 255.0;
          double v2 = v <= lo ? 0 : (v >= hi ? 1 : (span <= 0 ? 1 : (v - lo) / span));
          if (v2 <= 0) {
            bytes[i] = bytes[i + 1] = bytes[i + 2] = 0;
            continue;
          }
          double scale = (v2 * 255.0) / max;
          bytes[i] = Chan(b * scale);
          bytes[i + 1] = Chan(g * scale);
          bytes[i + 2] = Chan(r * scale);
        }
      }
      Marshal.Copy(bytes, 0, bd.Scan0, bytes.Length);
    } finally {
      bmp.UnlockBits(bd);
    }
  }

  static byte Chan(double v) {
    if (v <= 0) return 0;
    if (v >= 255) return 255;
    return (byte)Math.Round(v);
  }
}
"@
}

function Get-OcrPhrases($bmp, [int]$originX, [int]$originY, [bool]$exact = $false) {
  $out = New-Object System.Collections.ArrayList
  if (-not (Initialize-Ocr)) { return , $out }

  $maxDim = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $pixelCap = [Math]::Sqrt(12000000.0 / ([double]$bmp.Width * [double]$bmp.Height))
  $scale = [Math]::Min(2.0, [Math]::Min($pixelCap, [Math]::Min(($maxDim - 1) / $bmp.Width, ($maxDim - 1) / $bmp.Height)))
  if ($scale -lt 1.0 -and $bmp.Width -le $maxDim -and $bmp.Height -le $maxDim) { $scale = 1.0 }
  if ($scale -lt 0.5) { $scale = 0.5 }
  # The turned copy is already opaque pixels. Drawing it would turn that copy blank.
  if ($exact -and $bmp.Width -le $maxDim -and $bmp.Height -le $maxDim) { $scale = 1.0 }
  $src = $bmp
  if ([Math]::Abs($scale - 1.0) -gt 0.01) {
    $src = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $scale)), ([int]($bmp.Height * $scale))
    $g = [System.Drawing.Graphics]::FromImage($src)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.DrawImage($bmp, 0, 0, $src.Width, $src.Height)
    $g.Dispose()
  }
  # Never save the caller's bitmap: a second pass used to overwrite the same file and blank the shot.
  $toSave = $src
  $owned = $false
  if ([object]::ReferenceEquals($src, $bmp)) {
    $toSave = Copy-Bitmap32 $bmp
    $owned = $true
  }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("xpas-ocr-{0}.png" -f ([guid]::NewGuid().ToString('N')))
  try {
    $toSave.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($owned -or -not [object]::ReferenceEquals($src, $bmp)) { $toSave.Dispose() }
  }

  $stream = $null
  $results = New-Object System.Collections.ArrayList
  try {
    $file = Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
    $stream = Wait-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    [void]$results.Add([pscustomobject]@{ res = (Wait-WinRt ($script:OcrEngine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])); extra = $false })
    foreach ($eng in $script:OcrExtra) {
      try { [void]$results.Add([pscustomobject]@{ res = (Wait-WinRt ($eng.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])); extra = $true }) } catch {}
    }
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }

  foreach ($pass in $results) {
    $before = $out.Count
    foreach ($line in $pass.res.Lines) {
      $cur = $null
      foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        $wx = $r.X / $scale
        $wy = $r.Y / $scale
        $ww = $r.Width / $scale
        $wh = $r.Height / $scale
        if ($null -ne $cur) {
          $gap = $wx - ($cur.x + $cur.w)
          if ($gap -gt [Math]::Max(14.0, $wh * 1.4)) {
            [void]$out.Add($cur)
            $cur = $null
          }
        }
        $wt = [string]$w.Text
        if ($null -eq $cur) {
          $cur = @{ text = $wt; x = $wx; y = $wy; w = $ww; h = $wh; words = (New-Object System.Collections.ArrayList) }
        } else {
          $right = [Math]::Max($cur.x + $cur.w, $wx + $ww)
          $bottom = [Math]::Max($cur.y + $cur.h, $wy + $wh)
          $sep = ' '
          if ((Test-Cjk $wt) -and (Test-Cjk $cur.text.Substring($cur.text.Length - 1))) { $sep = '' }
          $cur.text = $cur.text + $sep + $wt
          $cur.y = [Math]::Min($cur.y, $wy)
          $cur.w = $right - $cur.x
          $cur.h = $bottom - $cur.y
        }
        [void]$cur.words.Add([pscustomobject]@{
            t = $wt
            x = [int]($originX + $wx); y = [int]($originY + $wy); w = [int][Math]::Ceiling($ww); h = [int][Math]::Ceiling($wh)
          })
      }
      if ($null -ne $cur) { [void]$out.Add($cur) }
    }
    if ($pass.extra) {
      # Keep only Asian-script phrases from the extra engines, and only where the main engine found nothing.
      $keep = New-Object System.Collections.ArrayList
      for ($i = 0; $i -lt $before; $i++) { [void]$keep.Add($out[$i]) }
      for ($i = $before; $i -lt $out.Count; $i++) {
        $p = $out[$i]
        if (-not (Test-Cjk $p.text)) { continue }
        $clash = $false
        for ($j = 0; $j -lt $before; $j++) {
          $q = $out[$j]
          $ix = [Math]::Max(0, [Math]::Min($p.x + $p.w, $q.x + $q.w) - [Math]::Max($p.x, $q.x))
          $iy = [Math]::Max(0, [Math]::Min($p.y + $p.h, $q.y + $q.h) - [Math]::Max($p.y, $q.y))
          if ($ix * $iy -gt 0.5 * [Math]::Min($p.w * $p.h, $q.w * $q.h)) { $clash = $true; break }
        }
        if ($clash) {
          # The main engine read this spot as Latin garbage; the Asian reading wins.
          for ($j = $keep.Count - 1; $j -ge 0; $j--) {
            $q = $keep[$j]
            $ix = [Math]::Max(0, [Math]::Min($p.x + $p.w, $q.x + $q.w) - [Math]::Max($p.x, $q.x))
            $iy = [Math]::Max(0, [Math]::Min($p.y + $p.h, $q.y + $q.h) - [Math]::Max($p.y, $q.y))
            if ($ix * $iy -gt 0.5 * [Math]::Min($p.w * $p.h, $q.w * $q.h) -and -not (Test-Cjk $q.text)) { $keep.RemoveAt($j) }
          }
        }
        [void]$keep.Add($p)
      }
      $out = $keep
    }
  }

  $result = New-Object System.Collections.ArrayList
  foreach ($p in $out) {
    [void]$result.Add([pscustomobject]@{
        text = $p.text; type = 'Text'; src = 'ocr'
        x = [int]($originX + $p.x); y = [int]($originY + $p.y); w = [int][Math]::Ceiling($p.w); h = [int][Math]::Ceiling($p.h)
        words = $p.words
      })
  }
  return , $result
}

function Convert-TiltRect($x, $y, $w, $h, [int]$bmpW, [int]$originX, [int]$originY) {
  # The phrase was read on a bitmap turned 90° counter-clockwise. Put the box back.
  $nx = $bmpW - $y - $h
  $ny = $x
  $nw = $h
  $nh = $w
  if ($nx -lt 0) { $nw += $nx; $nx = 0 }
  if ($ny -lt 0) { $nh += $ny; $ny = 0 }
  if ($nw -lt 1 -or $nh -lt 1) { return $null }
  return [pscustomobject]@{
    x = [int]($originX + $nx)
    y = [int]($originY + $ny)
    w = [int][Math]::Ceiling($nw)
    h = [int][Math]::Ceiling($nh)
  }
}

# Sideways text. The live shot is only read. A line that touches any upright box is dropped.
function Get-TiltedPhrases($bmp, [int]$originX, [int]$originY, $horizontal) {
  $kept = New-Object System.Collections.ArrayList
  $rot = [XpTurn]::Ccw($bmp)
  try {
    $phrases = Get-OcrPhrases $rot 0 0 $true
    $bmpW = [int]$bmp.Width
    foreach ($p in $phrases) {
      if ([string]::IsNullOrWhiteSpace([string]$p.text)) { continue }
      $box = Convert-TiltRect $p.x $p.y $p.w $p.h $bmpW $originX $originY
      if ($null -eq $box) { continue }
      $hit = $false
      foreach ($q in @($horizontal) + @($kept)) {
        if ($null -eq $q) { continue }
        if ((Test-Overlap $box $q) -gt 0) { $hit = $true; break }
      }
      if ($hit) { continue }
      $words = New-Object System.Collections.ArrayList
      foreach ($wd in @($p.words)) {
        if ($null -eq $wd) { continue }
        $wb = Convert-TiltRect $wd.x $wd.y $wd.w $wd.h $bmpW $originX $originY
        if ($null -eq $wb) { continue }
        [void]$words.Add([pscustomobject]@{ t = [string]$wd.t; x = $wb.x; y = $wb.y; w = $wb.w; h = $wb.h })
      }
      [void]$kept.Add([pscustomobject]@{
          text = [string]$p.text; type = 'Text'; src = 'ocr'
          x = $box.x; y = $box.y; w = $box.w; h = $box.h
          words = $words
        })
    }
  } finally {
    $rot.Dispose()
  }
  return , $kept
}

function Get-ScanRoots($win, [int]$ownPid, [bool]$fresh) {
  $roots = New-Object System.Collections.ArrayList
  if ($null -ne $win) {
    [void]$roots.Add($win)
    return , $roots
  }
  $cap = $(if ($fresh) { 12 } else { 3 })
  $root = $script:AE::RootElement
  $tray = $null
  $desk = $null
  $normal = New-Object System.Collections.ArrayList
  $c = $script:Walker.GetFirstChild($root)
  while ($null -ne $c) {
    try {
      $cur = $c.Current
      $cls = [string]$cur.ClassName
      if ($cls -eq 'Shell_TrayWnd') { $tray = $c }
      elseif ($cls -eq 'Progman' -or $cls -eq 'WorkerW') { if ($null -eq $desk -and $cls -eq 'Progman') { $desk = $c } }
      elseif ($normal.Count -lt $cap -and $cur.ProcessId -ne $ownPid -and -not $cur.IsOffscreen) {
        $h = [IntPtr]$cur.NativeWindowHandle
        $r = $cur.BoundingRectangle
        if ($h -ne [IntPtr]::Zero -and [XpNative]::IsWindowVisible($h) -and -not [XpNative]::IsIconic($h) -and -not [XpNative]::IsCloaked($h) -and $r.Width -gt 80 -and $r.Height -gt 60) {
          [void]$normal.Add($c)
        }
      }
    } catch {}
    $c = $script:Walker.GetNextSibling($c)
  }
  if ($null -ne $tray) { [void]$roots.Add($tray) }
  foreach ($n in $normal) { [void]$roots.Add($n) }
  if ($null -ne $desk) { [void]$roots.Add($desk) }
  return , $roots
}

function Test-Covered([double]$cx, [double]$cy, $rects) {
  foreach ($r in $rects) {
    if ($cx -ge $r.X -and $cx -le ($r.X + $r.Width) -and $cy -ge $r.Y -and $cy -le ($r.Y + $r.Height)) { return $true }
  }
  return $false
}

$script:UiaBudgetMs = 6000
$script:UiaSkipped = 0

function Get-UiaItems($roots, $area) {
  $items = New-Object System.Collections.ArrayList
  $cr = New-Object System.Windows.Automation.CacheRequest
  $cr.Add($script:AE::NameProperty)
  $cr.Add($script:AE::ControlTypeProperty)
  $cr.Add($script:AE::BoundingRectangleProperty)
  $cr.Add($script:AE::AutomationIdProperty)
  $cond = New-Object System.Windows.Automation.PropertyCondition($script:AE::IsOffscreenProperty, $false)
  $areaSize = [double]$area.w * [double]$area.h
  $above = New-Object System.Collections.ArrayList

  foreach ($root in $roots) {
    $rootRect = $null
    try { $rootRect = $root.Current.BoundingRectangle } catch {}
    $all = [XpText]::FindAllBounded($root, $cond, $cr, $script:UiaBudgetMs)
    if ($null -eq $all) {
      $script:UiaSkipped++
      $all = @()
    }
    foreach ($e in $all) {
      if ($items.Count -ge 450) { break }
      try {
        $name = [string]$e.Cached.Name
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $r = $e.Cached.BoundingRectangle
        if ($r.IsEmpty -or $r.Width -lt 3 -or $r.Height -lt 3) { continue }
        if (($r.Width * $r.Height) -gt ($areaSize * 0.25)) { continue }
        $cx = $r.X + $r.Width / 2
        $cy = $r.Y + $r.Height / 2
        if ($cx -lt $area.x -or $cy -lt $area.y -or $cx -gt ($area.x + $area.w) -or $cy -gt ($area.y + $area.h)) { continue }
        if (Test-Covered $cx $cy $above) { continue }
        $name = ($name -replace '\s+', ' ').Trim()
        if ($name.Length -gt 90) { $name = $name.Substring(0, 90) + '...' }
        $ct = ($e.Cached.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        [void]$items.Add([pscustomobject]@{
            text = $name; type = $ct; src = 'uia'
            x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
            aid = [string]$e.Cached.AutomationId
          })
      } catch {}
    }
    if ($null -ne $rootRect -and -not $rootRect.IsEmpty) { [void]$above.Add($rootRect) }
  }
  return , $items
}

function Test-Overlap($a, $b) {
  $x1 = [Math]::Max($a.x, $b.x); $y1 = [Math]::Max($a.y, $b.y)
  $x2 = [Math]::Min($a.x + $a.w, $b.x + $b.w); $y2 = [Math]::Min($a.y + $a.h, $b.y + $b.h)
  if ($x2 -le $x1 -or $y2 -le $y1) { return 0.0 }
  $inter = ($x2 - $x1) * ($y2 - $y1)
  $small = [Math]::Min($a.w * $a.h, $b.w * $b.h)
  if ($small -le 0) { return 0.0 }
  return $inter / $small
}

function ConvertTo-Key([string]$s) {
  return (($s.ToLowerInvariant()) -replace '[^\p{L}\p{N}]+', '')
}

function Merge-Items($uia, $ocr) {
  $merged = New-Object System.Collections.ArrayList
  $seen = @{}
  $rows = @{}
  foreach ($u in $uia) {
    $ku = ConvertTo-Key $u.text
    $sig = '{0}|{1}|{2}' -f $ku, [int](($u.x + $u.w / 2) / 8), [int](($u.y + $u.h / 2) / 8)
    if ($seen.ContainsKey($sig)) { continue }
    $seen[$sig] = $true
    $u | Add-Member -NotePropertyName k -NotePropertyValue $ku -Force
    [void]$merged.Add($u)
    $r0 = [int][Math]::Floor($u.y / 50)
    $r1 = [Math]::Min($r0 + 8, [int][Math]::Floor(($u.y + $u.h) / 50))
    for ($r = $r0; $r -le $r1; $r++) {
      if (-not $rows.ContainsKey($r)) { $rows[$r] = New-Object System.Collections.ArrayList }
      [void]$rows[$r].Add($u)
    }
  }
  foreach ($o in $ocr) {
    $ko = ConvertTo-Key $o.text
    if ($ko.Length -eq 0) { continue }
    $dup = $false
    $row = [int][Math]::Floor(($o.y + $o.h / 2) / 50)
    if ($rows.ContainsKey($row)) {
      foreach ($u in $rows[$row]) {
        if ($u.k.Length -gt 0 -and ($u.k.Contains($ko) -or $ko.Contains($u.k)) -and (Test-Overlap $o $u) -gt 0.5) { $dup = $true; break }
      }
    }
    if (-not $dup) { [void]$merged.Add($o) }
  }
  foreach ($m in $merged) { if ($m.PSObject.Properties['k']) { $m.PSObject.Properties.Remove('k') } }
  $sorted = @($merged | Sort-Object -Property @{ Expression = { [int]([Math]::Floor($_.y / 12)) } }, @{ Expression = { $_.x } })
  $final = New-Object System.Collections.ArrayList
  $id = 1
  foreach ($m in $sorted) {
    if ($final.Count -ge 400) { break }
    $m | Add-Member -NotePropertyName id -NotePropertyValue $id -Force
    $id++
    [void]$final.Add($m)
  }
  return , $final
}

function New-Bitmap24($bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $srcBd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $dstBd = $dst.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $ss = [int]$srcBd.Stride
    $ds = [int]$dstBd.Stride
    $sbytes = New-Object byte[] ($ss * $h)
    $dbytes = New-Object byte[] ($ds * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($srcBd.Scan0, $sbytes, 0, $sbytes.Length)
    for ($y = 0; $y -lt $h; $y++) {
      $srow = $y * $ss
      $drow = $y * $ds
      for ($x = 0; $x -lt $w; $x++) {
        $si = $srow + ($x * 4)
        $di = $drow + ($x * 3)
        $dbytes[$di] = $sbytes[$si]
        $dbytes[$di + 1] = $sbytes[$si + 1]
        $dbytes[$di + 2] = $sbytes[$si + 2]
      }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($dbytes, 0, $dstBd.Scan0, $dbytes.Length)
  } finally {
    $bmp.UnlockBits($srcBd)
    $dst.UnlockBits($dstBd)
  }
  return $dst
}

# $fit: a caller that wants coordinates from a model (İnisiyatif, UI-TARS) needs the picture at the size it asked for
# (maxW, snapped to a multiple of $snap), even without boxes. Without it a plain picture stays full size for the scanner preview.
function ConvertTo-JpegBase64($bmp, $items, $rect, [bool]$marks, [int]$maxW, [int]$snap = 0, [bool]$fit = $false) {
  $scale = [Math]::Min(1.0, $maxW / [double]$bmp.Width)
  $w = [int]($bmp.Width * $scale)
  $h = [int]($bmp.Height * $scale)
  if ($snap -gt 1) {
    $w = [Math]::Max($snap, [int]([Math]::Round($w / [double]$snap)) * $snap)
    $h = [Math]::Max($snap, [int]([Math]::Round($h / [double]$snap)) * $snap)
  }
  # The scanner preview has no boxes. Save the same pixel copy as the diagnostic PNG.
  # Drawing the shot into a new bitmap is what turned Blender and Chrome gray.
  if (-not $marks -and -not $fit) {
    $copy = Copy-Bitmap32 $bmp
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("xpas-preview-{0}.png" -f ([guid]::NewGuid().ToString('N')))
    try { $copy.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $copy.Dispose() }
    return [pscustomobject]@{ path = $path; data = ''; w = [int]$bmp.Width; h = [int]$bmp.Height; mime = 'image/png' }
  }
  # 24-bit copy has no alpha, so scaling cannot turn the shot gray.
  $solid = New-Bitmap24 $bmp
  $out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.DrawImage($solid, 0, 0, $w, $h)
  $solid.Dispose()
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  if ($marks) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $font = New-Object System.Drawing.Font('Tahoma', 9, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $penU = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 0, 90, 255)), 1
    $penO = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 255, 110, 0)), 1
    $bgU = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 0, 70, 220))
    $bgO = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 220, 90, 0))
    foreach ($it in $items) {
      $x = ($it.x - $rect.x) * $scale
      $y = ($it.y - $rect.y) * $scale
      $pen = $penU; $bg = $bgU
      if ($it.src -eq 'ocr') { $pen = $penO; $bg = $bgO }
      $g.DrawRectangle($pen, [float]$x, [float]$y, [float]([Math]::Max(2, $it.w * $scale)), [float]([Math]::Max(2, $it.h * $scale)))
      $label = [string]$it.id
      $sz = $g.MeasureString($label, $font)
      $g.FillRectangle($bg, [float]$x, [float]([Math]::Max(0, $y - $sz.Height + 2)), [float]$sz.Width, [float]($sz.Height - 2))
      $g.DrawString($label, $font, [System.Drawing.Brushes]::White, [float]$x, [float]([Math]::Max(0, $y - $sz.Height + 2)))
    }
    $font.Dispose(); $penU.Dispose(); $penO.Dispose(); $bgU.Dispose(); $bgO.Dispose()
  }
  $g.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]72)
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("xpas-preview-{0}.jpg" -f ([guid]::NewGuid().ToString('N')))
  $out.Save($path, $codec, $ep)
  $out.Dispose()
  return [pscustomobject]@{ path = $path; data = ''; w = $w; h = $h; mime = 'image/jpeg' }
}

# A tightly packed BGRA frame for the second reader (PP-OCRv4). Windows OCR does not use this file.
function Save-OnnxShot($bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  if ($w -lt 2 -or $h -lt 2) { return '' }
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("xpas-onnx-{0}.raw" -f ([guid]::NewGuid().ToString('N')))
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = [int]$bd.Stride
    $row = $w * 4
    $packed = New-Object byte[] ($row * $h)
    for ($y = 0; $y -lt $h; $y++) {
      $src = [System.IntPtr]::Add($bd.Scan0, ($y * $stride))
      [System.Runtime.InteropServices.Marshal]::Copy($src, $packed, ($y * $row), $row)
    }
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
      $bw.Write([byte]88)
      $bw.Write([byte]80)
      $bw.Write([byte]65)
      $bw.Write([byte]83)
      $bw.Write([int32]$w)
      $bw.Write([int32]$h)
      $bw.Write($packed)
      $bw.Flush()
    } finally { $bw.Dispose() }
  } finally {
    $bmp.UnlockBits($bd)
  }
  return $path
}

function Invoke-Scan($P) {
  $fresh = $false
  if ($P.fresh -eq $true) { $fresh = $true }
  $win = $null
  $missing = ''
  # A fresh scan ignores the pinned target window and does not steal focus,
  # so a dialog or page that just appeared is part of the tree and the OCR.
  if (-not $fresh -and $P.windowTitle) {
    $win = Find-WindowOrNull ([string]$P.windowTitle)
    if ($null -eq $win) {
      $missing = [string]$P.windowTitle
    } else {
      Enter-Window $win
      Start-Sleep -Milliseconds 150
    }
  }
  $rect = Get-CaptureRect $win
  if ($null -eq $win -and $P.primary -eq $true) {
    $pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $rect = [pscustomobject]@{ x = $pb.X; y = $pb.Y; w = $pb.Width; h = $pb.Height }
  }
  $own = 0
  if ($P.ownPid) { $own = [int]$P.ownPid }

  $uia = New-Object System.Collections.ArrayList
  $script:UiaSkipped = 0
  if ($P.uia -ne $false) { $uia = Get-UiaItems (Get-ScanRoots $win $own $fresh) $rect }

  $bmp = Capture-Raw $rect
  Set-BitmapOpaque $bmp
  $ocr = New-Object System.Collections.ArrayList
  $ocrOk = $false
  $shot = ''
  $sideCount = 0
  $script:ValueLo = 0.15
  $script:ValueHi = 0.80
  # The window keeps this copy. Value squeeze below touches only the reader bitmap.
  $shotBmp = $null
  $mode = [string]$P.image
  if ($mode -eq 'plain' -or $mode -eq 'marked') { $shotBmp = Copy-Bitmap32 $bmp }
  $sig = ''
  if ($P.sig -eq $true) { $sig = [Convert]::ToBase64String([XpImage]::Signature($bmp)) }
  if ($P.ocr -ne $false) {
    $ocrOk = Initialize-Ocr
    if ($null -ne $P.valueLo) { $script:ValueLo = [double]$P.valueLo }
    if ($null -ne $P.valueHi) { $script:ValueHi = [double]$P.valueHi }
    if ($ocrOk) {
      try { [XpTurn]::CompressValue($bmp, $script:ValueLo, $script:ValueHi) } catch {}
      $ocr = Get-OcrPhrases $bmp $rect.x $rect.y
    }
    try { $shot = Save-OnnxShot $bmp } catch { $shot = '' }
  }
  if ($P.tilt -eq $true -and $ocrOk) {
    try {
      $tilted = Get-TiltedPhrases $bmp ([int]$rect.x) ([int]$rect.y) $ocr
      $sideCount = @($tilted).Count
      foreach ($p in @($tilted)) { if ($null -ne $p) { [void]$ocr.Add($p) } }
    } catch {
      $sideCount = 0
    }
  }
  $items = Merge-Items $uia $ocr

  $img = $null
  if ($null -ne $shotBmp) {
    $maxW = 1400
    if ($P.maxImageW) { $maxW = [int]$P.maxImageW }
    $snap = 0
    if ($P.snap) { $snap = [int]$P.snap }
    $img = ConvertTo-JpegBase64 $shotBmp $items $rect ($mode -eq 'marked') $maxW $snap ($P.fit -eq $true)
    $shotBmp.Dispose()
  }
  $bmp.Dispose()

  return [pscustomobject]@{
    area   = $rect
    items  = $items
    ocr    = $ocrOk
    uiaCount = $uia.Count
    ocrCount = $ocr.Count
    image  = $img
    window = $(if ($null -ne $win) { [string]$win.Current.Name } else { '' })
    missingWindow = $missing
    sig    = $sig
    uiaSkipped = $script:UiaSkipped
    shot   = $shot
    sideCount = $sideCount
  }
}

# A small lossless picture of what is under a screen rectangle (an icon, a button), for finding it again later.
function Get-IconCrop($r) {
  $v = Get-VirtualScreen
  $pad = 3
  $w = [Math]::Min(220, [Math]::Max(18, [int]$r.w + 2 * $pad))
  $h = [Math]::Min(140, [Math]::Max(18, [int]$r.h + 2 * $pad))
  $cx = [int]($r.x + $r.w / 2)
  $cy = [int]($r.y + $r.h / 2)
  $x = [Math]::Max($v.x, [Math]::Min($v.x + $v.w - $w, $cx - [int]($w / 2)))
  $y = [Math]::Max($v.y, [Math]::Min($v.y + $v.h - $h, $cy - [int]($h / 2)))
  $rect = [pscustomobject]@{ x = $x; y = $y; w = $w; h = $h }
  $bmp = Get-ScreenBitmap $rect
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  return [pscustomobject]@{ data = $b64; w = $w; h = $h; dx = $cx - $x - [int]($w / 2); dy = $cy - $y - [int]($h / 2) }
}

function Get-PatchAt([int]$x, [int]$y, [int]$size) {
  return (Get-IconCrop ([pscustomobject]@{ x = $x - [int]($size / 2) + 3; y = $y - [int]($size / 2) + 3; w = $size - 6; h = $size - 6 }))
}

function Invoke-FindImage($P) {
  $bytes = [Convert]::FromBase64String([string]$P.icon)
  $ms = New-Object System.IO.MemoryStream(, $bytes)
  $tpl = New-Object System.Drawing.Bitmap $ms
  $win = $null
  if ($P.windowTitle) { $win = Find-WindowOrNull ([string]$P.windowTitle) }
  $rect = Get-CaptureRect $win
  if ($P.region) {
    $v = Get-VirtualScreen
    $x1 = [Math]::Max($v.x, [int]$P.region.x); $y1 = [Math]::Max($v.y, [int]$P.region.y)
    $x2 = [Math]::Min($v.x + $v.w, [int]($P.region.x + $P.region.w)); $y2 = [Math]::Min($v.y + $v.h, [int]($P.region.y + $P.region.h))
    if ($x2 - $x1 -gt $tpl.Width -and $y2 - $y1 -gt $tpl.Height) { $rect = [pscustomobject]@{ x = $x1; y = $y1; w = $x2 - $x1; h = $y2 - $y1 } }
  }
  $bmp = Get-ScreenBitmap $rect
  $tpl24 = New-Object System.Drawing.Bitmap $tpl.Width, $tpl.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($tpl24)
  $g.DrawImage($tpl, 0, 0, $tpl.Width, $tpl.Height)
  $g.Dispose()
  $r = [XpImage]::Find($bmp, $tpl24)
  $bmp.Dispose(); $tpl.Dispose(); $tpl24.Dispose(); $ms.Dispose()
  return [pscustomobject]@{ x = [int]($rect.x + $r[0]); y = [int]($rect.y + $r[1]); score = [double]$r[2]; window = $(if ($null -ne $win) { [string]$win.Current.Name } else { '' }) }
}

function Get-TextNear([int]$px, [int]$py) {
  if (-not (Initialize-Ocr)) { return '' }
  $v = Get-VirtualScreen
  $x = [Math]::Max($v.x, $px - 180)
  $y = [Math]::Max($v.y, $py - 40)
  $rect = [pscustomobject]@{ x = $x; y = $y; w = [Math]::Min(360, $v.x + $v.w - $x); h = [Math]::Min(80, $v.y + $v.h - $y) }
  $bmp = Get-ScreenBitmap $rect
  $phrases = Get-OcrPhrases $bmp $rect.x $rect.y
  $bmp.Dispose()
  $best = ''
  $bestD = [double]::MaxValue
  foreach ($p in $phrases) {
    $inside = $px -ge $p.x -and $px -le ($p.x + $p.w) -and $py -ge $p.y -and $py -le ($p.y + $p.h)
    $d = [Math]::Abs(($p.x + $p.w / 2) - $px) + 2 * [Math]::Abs(($p.y + $p.h / 2) - $py)
    if ($inside) { $d = 0 }
    if ($d -lt $bestD) { $bestD = $d; $best = $p.text }
  }
  if ($bestD -gt 120) { return '' }
  return $best
}

function Invoke-MouseAt([int]$x, [int]$y, [string]$button) {
  [void][XpNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 50
  switch ($button) {
    'right' {
      [XpNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 30
      [XpNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    }
    'double' {
      for ($i = 0; $i -lt 2; $i++) {
        [XpNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 40
        [XpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 120
      }
    }
    default {
      [XpNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 30
      [XpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
}
