# Long-running automation worker.
# Request line:  <id>\t<op>\t<base64 utf8 json payload>
# Response line: <id>\t<base64 utf8 json {ok,data|error}>

. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'screen.ps1')

function ConvertTo-SendKeysText([string]$t) {
  return ($t -replace '([\+\^%~\(\)\{\}\[\]])', '{$1}')
}

function Send-TextPaced([string]$t, [int]$gapMs) {
  if ([string]::IsNullOrEmpty($t)) { return }
  foreach ($ch in $t.ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysText ([string]$ch)))
    if ($gapMs -gt 0) { Start-Sleep -Milliseconds $gapMs }
  }
}

if (-not ('XpWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class XpWin {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lp, int nMax);
  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(256);
    if (h == IntPtr.Zero) return "";
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@
}

function Test-TextLike($el) {
  if ($null -eq $el) { return $false }
  if (@('Edit', 'Document', 'ComboBox') -contains (Get-CT $el)) { return $true }
  $vp = $null
  try { return $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) } catch { return $false }
}

function Get-TextCandidates($root, [int]$maxDepth) {
  $out = New-Object System.Collections.ArrayList
  if ($null -eq $root) { return , $out }
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue(@{ el = $root; d = 0 })
  $seen = 0
  while ($queue.Count -gt 0 -and $seen -lt 500) {
    $pair = $queue.Dequeue()
    $el = $pair.el
    $d = [int]$pair.d
    $seen++
    if (Test-TextLike $el) { [void]$out.Add($el) }
    if ($d -ge $maxDepth) { continue }
    $child = $null
    try { $child = $script:Walker.GetFirstChild($el) } catch {}
    while ($null -ne $child) {
      $queue.Enqueue(@{ el = $child; d = ($d + 1) })
      try { $child = $script:Walker.GetNextSibling($child) } catch { break }
    }
  }
  return , $out
}

function Get-WinClass($el) {
  $h = [IntPtr]::Zero
  $p = $el
  for ($i = 0; $i -lt 6 -and $h -eq [IntPtr]::Zero -and $null -ne $p; $i++) {
    try { $h = [IntPtr]$p.Current.NativeWindowHandle } catch { $h = [IntPtr]::Zero }
    if ($h -ne [IntPtr]::Zero) { break }
    try { $p = $script:Walker.GetParent($p) } catch { break }
  }
  try { return [XpWin]::ClassOf($h) } catch { return '' }
}

# An edit inside a combo box is the same field, not a second one.
function Get-OwnInputs($win) {
  $all = @(Get-TextCandidates $win 12 | Where-Object { @('Edit', 'Document', 'ComboBox') -contains (Get-CT $_) })
  $own = @()
  foreach ($el in $all) {
    $inside = $false
    if ((Get-CT $el) -eq 'Edit') {
      $p = $el
      for ($i = 0; $i -lt 6; $i++) {
        try { $p = $script:Walker.GetParent($p) } catch { break }
        if ($null -eq $p) { break }
        foreach ($c in $all) {
          if ((Get-CT $c) -eq 'ComboBox' -and (Test-Same $p $c)) { $inside = $true }
        }
        if ($inside) { break }
      }
    }
    if (-not $inside) { $own += $el }
  }
  return @($own)
}

function Find-InputAround($el) {
  $p = $el
  for ($i = 0; $i -lt 8 -and $null -ne $p; $i++) {
    if (Test-TextLike $p) { return $p }
    $child = $null
    try { $child = $script:Walker.GetFirstChild($p) } catch {}
    while ($null -ne $child) {
      if (Test-TextLike $child) { return $child }
      try { $child = $script:Walker.GetNextSibling($child) } catch { break }
    }
    try { $p = $script:Walker.GetParent($p) } catch { break }
  }
  return $null
}

# The click point's own field, or the only field of an open dialog. Not "whatever edit is nearest".
function Find-TypeTarget([int]$x, [int]$y) {
  if ($x -ne 0 -or $y -ne 0) {
    $hit = $null
    try { $hit = $script:AE::FromPoint((New-Object System.Windows.Point($x, $y))) } catch {}
    $around = Find-InputAround $hit
    if ($null -ne $around) { return @{ el = $around; where = 'tıklanan nokta' } }
  }
  $fg = [XpNative]::GetForegroundWindow()
  $wins = @()
  if ($fg -ne [IntPtr]::Zero) {
    try { $wins += $script:AE::FromHandle($fg) } catch {}
  }
  foreach ($w in @(Get-TopWindows 0)) {
    if (Test-UsableWindow $w) { $wins += $w }
  }
  $solo = @()
  $seen = @{}
  foreach ($w in $wins) {
    if ((Get-WinClass $w) -ne '#32770') { continue }
    $inputs = @(Get-OwnInputs $w)
    if ($inputs.Count -ne 1) { continue }
    $r = $inputs[0].Current.BoundingRectangle
    $key = "$([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $name = ''
    try { $name = [string]$w.Current.Name } catch {}
    $solo += @{ el = $inputs[0]; where = $(if ($name) { $name } else { 'iletişim kutusu' }) }
  }
  if ($solo.Count -eq 1) { return $solo[0] }
  return $null
}

function Set-TextValue($el, [string]$text) {
  $target = $el
  if ((Get-CT $el) -eq 'ComboBox') {
    $edit = @(Get-TextCandidates $el 4 | Where-Object { (Get-CT $_) -eq 'Edit' } | Select-Object -First 1)
    if ($edit) { $target = $edit[0] }
  }
  $vp = $null
  $holder = $target
  if (-not $holder.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
    $holder = $el
    if (-not $holder.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { return $false }
  }
  try { if ($vp.Current.IsReadOnly) { return $false } } catch {}
  try { $vp.SetValue($text) } catch { return $false }
  try { $holder.SetFocus() } catch {}
  return $true
}

function Invoke-Op([string]$op, $P) {
  Set-HudHandle $P
  switch ($op) {
    'ping' {
      return [pscustomobject]@{ ocr = (Initialize-Ocr); ps = $PSVersionTable.PSVersion.ToString() }
    }
    'listWindows' {
      $own = 0
      if ($P.ownPid) { $own = [int]$P.ownPid }
      $out = New-Object System.Collections.ArrayList
      foreach ($w in (Get-TopWindows $own)) {
        try {
          $h = [IntPtr]$w.Current.NativeWindowHandle
          if ($h -ne [IntPtr]::Zero -and ([XpNative]::IsCloaked($h) -or -not [XpNative]::IsWindowVisible($h))) { continue }
          [void]$out.Add([pscustomobject]@{ title = [string]$w.Current.Name; handle = [string]$w.Current.NativeWindowHandle })
        } catch {}
      }
      return , $out
    }
    'scan' {
      return (Invoke-Scan $P)
    }
    'clickAt' {
      Invoke-MouseAt ([int]$P.x) ([int]$P.y) ([string]$P.button)
      return $true
    }
    'locate' {
      $win = Find-WindowOrNull ([string]$P.windowTitle)
      if ($null -eq $win) { return $null }
      Enter-Window $win
      $el = Find-ByLocator $win $P.locator
      if ($null -eq $el) { return $null }
      $off = $false
      try { $off = $el.Current.IsOffscreen } catch {}
      $r = $el.Current.BoundingRectangle
      if ($off -or $r.IsEmpty -or $r.Width -le 0 -or [double]::IsInfinity($r.X)) { return $null }
      $enabled = $true
      try { $enabled = [bool]$el.Current.IsEnabled } catch {}
      return [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; name = [string]$el.Current.Name; enabled = $enabled }
    }
    'crop' {
      $v = Get-VirtualScreen
      $x = [Math]::Max($v.x, [int]$P.x)
      $y = [Math]::Max($v.y, [int]$P.y)
      $w = [Math]::Max(20, [Math]::Min([int]$P.w, $v.x + $v.w - $x))
      $h = [Math]::Max(20, [Math]::Min([int]$P.h, $v.y + $v.h - $y))
      $rect = [pscustomobject]@{ x = $x; y = $y; w = $w; h = $h }
      $bmp = Get-ScreenBitmap $rect
      $maxW = 800
      if ($P.maxW) { $maxW = [int]$P.maxW }
      $img = ConvertTo-JpegBase64 $bmp (New-Object System.Collections.ArrayList) $rect $false $maxW
      $bmp.Dispose()
      return [pscustomobject]@{ area = $rect; image = $img }
    }
    'windowRect' {
      $win = Find-Window ([string]$P.windowTitle)
      Enter-Window $win
      $r = $win.Current.BoundingRectangle
      return [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
    }
    'typeText' {
      # Click, select, delete, type and Enter each get a gap so the field can catch up.
      $out = [ordered]@{ cleared = $false; skippedClear = $false; pasted = $false; focusType = ''; rescued = $false; where = ''; via = '' }
      $focus = $null
      try { $focus = $script:AE::FocusedElement } catch {}
      if ($null -ne $focus) { $out.focusType = Get-CT $focus }
      $atX = 0
      $atY = 0
      if ($P.x) { $atX = [int]$P.x }
      if ($P.y) { $atY = [int]$P.y }
      $target = $null
      if ($P.clearFirst -and -not (Test-TextLike $focus)) {
        $target = Find-TypeTarget $atX $atY
      }
      if ($null -ne $target -and $P.text) {
        if (Set-TextValue $target.el ([string]$P.text)) {
          $out.rescued = $true
          $out.where = [string]$target.where
          $out.via = 'value'
          $out.focusType = Get-CT $target.el
          $out.cleared = $true
          if ($P.pressEnter) {
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          }
          return [pscustomobject]$out
        }
      }
      if ($P.clearFirst) {
        # Ctrl+A / Delete only inside a text field; elsewhere it would select and delete the app's content.
        if (Test-TextLike $focus) {
          Start-Sleep -Milliseconds 120
          [System.Windows.Forms.SendKeys]::SendWait('^a')
          Start-Sleep -Milliseconds 280
          [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
          Start-Sleep -Milliseconds 200
          $out.cleared = $true
        } else {
          $out.skippedClear = $true
          return [pscustomobject]$out
        }
      }
      $text = [string]$P.text
      if ($text.Length -gt 0) {
        if ([XpText]::CanType($text)) {
          Send-TextPaced $text 20
        } else {
          $old = [XpText]::SetClipboard($text)
          Start-Sleep -Milliseconds 80
          [System.Windows.Forms.SendKeys]::SendWait('^v')
          Start-Sleep -Milliseconds 250
          [XpText]::RestoreClipboard($old)
          $out.pasted = $true
        }
      }
      if ($P.pressEnter) {
        Start-Sleep -Milliseconds 240
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      }
      return [pscustomobject]$out
    }
    'locked' {
      # The lock screen / UAC secure desktop: screenshots are black and input goes nowhere.
      return [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
    }
    'ocrInfo' {
      return (Get-OcrInfo)
    }
    'patch' {
      $size = 64
      if ($P.size) { $size = [int]$P.size }
      return (Get-PatchAt ([int]$P.x) ([int]$P.y) $size)
    }
    'keys' {
      if ($P.windowTitle) {
        $win = Find-WindowOrNull ([string]$P.windowTitle)
        if ($null -ne $win) { Enter-Window $win }
      }
      [System.Windows.Forms.SendKeys]::SendWait([string]$P.keys)
      return $true
    }
    'foreground' {
      $h = [XpNative]::GetForegroundWindow()
      if ($h -eq [IntPtr]::Zero) { return $null }
      $el = $script:AE::FromHandle($h)
      if ($null -eq $el) { return $null }
      $procName = ''
      try { $procName = (Get-Process -Id ([int]$el.Current.ProcessId) -ErrorAction Stop).ProcessName } catch {}
      return [pscustomobject]@{ title = [string]$el.Current.Name; pid = [int]$el.Current.ProcessId; proc = $procName }
    }
    'focusedValue' {
      $el = $script:AE::FocusedElement
      if ($null -eq $el) { return $null }
      $vp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
        return [pscustomobject]@{ value = [string]$vp.Current.Value; type = (Get-CT $el) }
      }
      return $null
    }
    'capture' {
      $pt = Get-CursorPoint
      $el = $script:AE::FromPoint((New-Object System.Windows.Point($pt.X, $pt.Y)))
      if ($null -eq $el) { return $null }
      $top = Get-TopLevel $el
      $loc = New-Locator $el $top $pt.X $pt.Y
      $er = $el.Current.BoundingRectangle
      $box = [pscustomobject]@{ x = $pt.X - 20; y = $pt.Y - 20; w = 40; h = 40 }
      if (-not $er.IsEmpty -and $er.Width -le 220 -and $er.Height -le 140) { $box = [pscustomobject]@{ x = $er.X; y = $er.Y; w = $er.Width; h = $er.Height } }
      $icon = Get-IconCrop $box
      $loc | Add-Member -NotePropertyName icon -NotePropertyValue $icon.data -Force
      return $loc
    }
    'pick' {
      # A box chosen in the screen scanner: the element under its centre, plus a picture of the box itself.
      $cx = [int]($P.x + $P.w / 2)
      $cy = [int]($P.y + $P.h / 2)
      $el = $null
      try { $el = $script:AE::FromPoint((New-Object System.Windows.Point($cx, $cy))) } catch {}
      $loc = $null
      if ($null -ne $el) {
        $top = Get-TopLevel $el
        $loc = New-Locator $el $top $cx $cy
      } else {
        $loc = [pscustomobject]@{ name = ''; text = ''; controlType = 'Point'; path = ''; x = $cx; y = $cy }
      }
      $icon = Get-IconCrop ([pscustomobject]@{ x = [int]$P.x; y = [int]$P.y; w = [int]$P.w; h = [int]$P.h })
      $loc | Add-Member -NotePropertyName icon -NotePropertyValue $icon.data -Force
      return $loc
    }
    'findImage' {
      return (Invoke-FindImage $P)
    }
    'drag' {
      [XpInput]::Drag([int]$P.x1, [int]$P.y1, [int]$P.x2, [int]$P.y2)
      return $true
    }
    'scroll' {
      $clicks = 5
      if ($P.clicks) { $clicks = [int]$P.clicks }
      $dir = [string]$P.direction
      $horizontal = ($dir -eq 'left' -or $dir -eq 'right')
      if ($dir -eq 'down' -or $dir -eq 'left') { $clicks = -$clicks }
      [XpInput]::Wheel([int]$P.x, [int]$P.y, $clicks, $horizontal)
      return $true
    }
    'hotkey' {
      $names = @($P.keys | ForEach-Object { [string]$_ })
      $err = [XpInput]::Combo($names)
      if ($err) { throw $err }
      return $true
    }
    default { throw "UNKNOWN_OP: $op" }
  }
}

function Send-Response([string]$id, $obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 12
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.WriteLine("$id`t$b64")
  [Console]::Out.Flush()
}

[void](Initialize-Ocr)
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }
  $parts = $line.Split("`t")
  $id = $parts[0]
  try {
    $P = New-Object psobject
    if ($parts.Length -gt 2 -and $parts[2].Length -gt 0) {
      $P = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2])) | ConvertFrom-Json
    }
    $data = Invoke-Op $parts[1] $P
    Send-Response $id ([pscustomobject]@{ ok = $true; data = $data })
  } catch {
    Send-Response $id ([pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message })
  }
}
