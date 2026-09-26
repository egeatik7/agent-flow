# Screen capture, Windows OCR and visible UI Automation scan.
# Requires common.ps1 to be dot-sourced first. All coordinates are physical screen pixels.

$script:OcrTried = $false
$script:OcrEngine = $null

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
  } catch {
    $script:OcrEngine = $null
  }
  return ($null -ne $script:OcrEngine)
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

function Get-ScreenBitmap($rect) {
  $bmp = New-Object System.Drawing.Bitmap ([int]$rect.w), ([int]$rect.h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$rect.x, [int]$rect.y, 0, 0, $bmp.Size)
  $g.Dispose()
  return $bmp
}

function Get-OcrPhrases($bmp, [int]$originX, [int]$originY) {
  $out = New-Object System.Collections.ArrayList
  if (-not (Initialize-Ocr)) { return , $out }

  $maxDim = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $pixelCap = [Math]::Sqrt(12000000.0 / ([double]$bmp.Width * [double]$bmp.Height))
  $scale = [Math]::Min(2.0, [Math]::Min($pixelCap, [Math]::Min(($maxDim - 1) / $bmp.Width, ($maxDim - 1) / $bmp.Height)))
  if ($scale -lt 1.0 -and $bmp.Width -le $maxDim -and $bmp.Height -le $maxDim) { $scale = 1.0 }
  if ($scale -lt 0.5) { $scale = 0.5 }
  $src = $bmp
  if ([Math]::Abs($scale - 1.0) -gt 0.01) {
    $src = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $scale)), ([int]($bmp.Height * $scale))
    $g = [System.Drawing.Graphics]::FromImage($src)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bmp, 0, 0, $src.Width, $src.Height)
    $g.Dispose()
  }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("xpas-ocr-{0}.png" -f $PID)
  $src.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  if (-not [object]::ReferenceEquals($src, $bmp)) { $src.Dispose() }

  $stream = $null
  try {
    $file = Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
    $stream = Wait-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Wait-WinRt ($script:OcrEngine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }

  foreach ($line in $res.Lines) {
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
      if ($null -eq $cur) {
        $cur = @{ text = [string]$w.Text; x = $wx; y = $wy; w = $ww; h = $wh; words = (New-Object System.Collections.ArrayList) }
      } else {
        $right = [Math]::Max($cur.x + $cur.w, $wx + $ww)
        $bottom = [Math]::Max($cur.y + $cur.h, $wy + $wh)
        $cur.text = $cur.text + ' ' + [string]$w.Text
        $cur.y = [Math]::Min($cur.y, $wy)
        $cur.w = $right - $cur.x
        $cur.h = $bottom - $cur.y
      }
      [void]$cur.words.Add([pscustomobject]@{
          t = [string]$w.Text
          x = [int]($originX + $wx); y = [int]($originY + $wy); w = [int][Math]::Ceiling($ww); h = [int][Math]::Ceiling($wh)
        })
    }
    if ($null -ne $cur) { [void]$out.Add($cur) }
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

function Get-ScanRoots($win, [int]$ownPid) {
  $roots = New-Object System.Collections.ArrayList
  if ($null -ne $win) {
    [void]$roots.Add($win)
    return , $roots
  }
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
      elseif ($normal.Count -lt 3 -and $cur.ProcessId -ne $ownPid -and -not $cur.IsOffscreen) {
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
    $all = @()
    $act = $cr.Activate()
    try { $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) } catch {} finally { $act.Dispose() }
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

function ConvertTo-JpegBase64($bmp, $items, $rect, [bool]$marks, [int]$maxW) {
  $scale = [Math]::Min(1.0, $maxW / [double]$bmp.Width)
  $w = [int]($bmp.Width * $scale)
  $h = [int]($bmp.Height * $scale)
  $out = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $g.DrawImage($bmp, 0, 0, $w, $h)
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
  $ms = New-Object System.IO.MemoryStream
  $out.Save($ms, $codec, $ep)
  $out.Dispose()
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  return [pscustomobject]@{ data = $b64; w = $w; h = $h }
}

function Invoke-Scan($P) {
  $win = $null
  $missing = ''
  if ($P.windowTitle) {
    $win = Find-WindowOrNull ([string]$P.windowTitle)
    if ($null -eq $win) {
      $missing = [string]$P.windowTitle
    } else {
      Enter-Window $win
      Start-Sleep -Milliseconds 150
    }
  }
  $rect = Get-CaptureRect $win
  $own = 0
  if ($P.ownPid) { $own = [int]$P.ownPid }

  $uia = New-Object System.Collections.ArrayList
  if ($P.uia -ne $false) { $uia = Get-UiaItems (Get-ScanRoots $win $own) $rect }

  $bmp = Get-ScreenBitmap $rect
  $ocr = New-Object System.Collections.ArrayList
  $ocrOk = $false
  if ($P.ocr -ne $false) {
    $ocrOk = Initialize-Ocr
    if ($ocrOk) { $ocr = Get-OcrPhrases $bmp $rect.x $rect.y }
  }
  $items = Merge-Items $uia $ocr

  $img = $null
  $mode = [string]$P.image
  if ($mode -eq 'plain' -or $mode -eq 'marked') {
    $maxW = 1400
    if ($P.maxImageW) { $maxW = [int]$P.maxImageW }
    $img = ConvertTo-JpegBase64 $bmp $items $rect ($mode -eq 'marked') $maxW
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
  }
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
        Start-Sleep -Milliseconds 20
        [XpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
      }
    }
    default {
      [XpNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 30
      [XpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
}
