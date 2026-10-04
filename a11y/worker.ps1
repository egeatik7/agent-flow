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

# SendKeys has no Windows key. "#" holds it (like ^ % +); {WIN}/{LWIN}/{RWIN} tap it.
# A string with none of those is handed to SendKeys unchanged.
function Get-SendKeysModifier([char]$ch) {
  switch ([string]$ch) {
    '^' { return 0x11 }
    '%' { return 0x12 }
    '+' { return 0x10 }
    '#' { return 0x5B }
  }
  return 0
}

function Add-KeyMods($list, $src) {
  if ($null -eq $src) { return }
  foreach ($m in @($src)) {
    if ($null -ne $m) { [void]$list.Add([int]$m) }
  }
}

function Join-KeyMods($first, $second) {
  $list = New-Object 'System.Collections.Generic.List[int]'
  Add-KeyMods $list $first
  Add-KeyMods $list $second
  return ,([int[]]$list.ToArray())
}

# Index of the closing brace, or -1. "{{}" and "{}}" are the literal braces.
function Get-SendKeysBraceEnd([string]$s, [int]$i) {
  if ($i + 2 -lt $s.Length -and $s[$i + 2] -eq '}' -and ($s[$i + 1] -eq '{' -or $s[$i + 1] -eq '}')) {
    return $i + 2
  }
  return $s.IndexOf('}', $i + 1)
}

function Get-NamedSendKey([string]$upper) {
  if (-not $script:SendKeyNames) {
    $script:SendKeyNames = @{
      ENTER = 0x0D; ESC = 0x1B; ESCAPE = 0x1B; TAB = 0x09
      BACKSPACE = 0x08; BS = 0x08; BKSP = 0x08
      DELETE = 0x2E; DEL = 0x2E; INSERT = 0x2D; INS = 0x2D
      HOME = 0x24; END = 0x23; PGUP = 0x21; PGDN = 0x22
      LEFT = 0x25; RIGHT = 0x27; UP = 0x26; DOWN = 0x28
      HELP = 0x2F; CAPSLOCK = 0x14; NUMLOCK = 0x90; SCROLLLOCK = 0x91
      PRTSC = 0x2C; BREAK = 0x13
      ADD = 0x6B; SUBTRACT = 0x6D; MULTIPLY = 0x6A; DIVIDE = 0x6F
      WIN = 0x5B; LWIN = 0x5B; RWIN = 0x5C
    }
  }
  if ($script:SendKeyNames.ContainsKey($upper)) { return [int]$script:SendKeyNames[$upper] }
  return -1
}

function Test-SendKeysHasWin([string]$keys) {
  if ([string]::IsNullOrEmpty($keys)) { return $false }
  for ($i = 0; $i -lt $keys.Length; $i++) {
    $ch = $keys[$i]
    if ($ch -eq '#') { return $true }
    if ($ch -ne '{') { continue }
    $end = Get-SendKeysBraceEnd $keys $i
    if ($end -lt 0) { return $false }
    $body = $keys.Substring($i + 1, $end - $i - 1).Trim()
    $name = $body
    $sp = $body.LastIndexOf(' ')
    if ($sp -gt 0) { $name = $body.Substring(0, $sp).Trim() }
    $upper = $name.ToUpperInvariant()
    if ($upper -eq 'WIN' -or $upper -eq 'LWIN' -or $upper -eq 'RWIN') { return $true }
    $i = $end
  }
  return $false
}

function Read-SendKeysBrace([string]$s, [int]$i) {
  $end = Get-SendKeysBraceEnd $s $i
  if ($end -lt 0) { throw 'Tuş dizisinde kapanmayan süslü parantez.' }
  $body = $s.Substring($i + 1, $end - $i - 1).Trim()
  $next = $end + 1
  if ($body.Length -eq 0) { throw 'Tuş tanınmadı: {}' }
  $times = 1
  $name = $body
  $sp = $body.LastIndexOf(' ')
  if ($sp -gt 0) {
    $tail = $body.Substring($sp + 1)
    $n = 0
    if ([int]::TryParse($tail, [ref]$n) -and $n -ge 1) {
      $head = $body.Substring(0, $sp).Trim()
      if ($head.Length -gt 0) { $name = $head; $times = $n }
    }
  }
  if ($name.Length -eq 1) {
    return [pscustomobject]@{ kind = 'char'; char = $name; times = $times; next = $next }
  }
  $upper = $name.ToUpperInvariant()
  if ($upper -match '^F(1[0-9]|2[0-4]|[1-9])$') {
    $fn = [int]$Matches[1]
    return [pscustomobject]@{ kind = 'vk'; vk = (0x70 + $fn - 1); times = $times; next = $next }
  }
  $vk = Get-NamedSendKey $upper
  if ($vk -lt 0) { throw "Tuş tanınmadı: {$name}" }
  return [pscustomobject]@{ kind = 'vk'; vk = $vk; times = $times; next = $next }
}

function Get-SendKeysGroupEnd([string]$s, [int]$open) {
  $depth = 1
  $i = $open + 1
  while ($i -lt $s.Length) {
    if ($s[$i] -eq '{') {
      $end = Get-SendKeysBraceEnd $s $i
      if ($end -lt 0) { throw 'Tuş dizisinde kapanmayan süslü parantez.' }
      $i = $end + 1
      continue
    }
    if ($s[$i] -eq '(') { $depth++ }
    elseif ($s[$i] -eq ')') {
      $depth--
      if ($depth -eq 0) { return $i }
    }
    $i++
  }
  throw 'Tuş dizisinde kapanmayan parantez.'
}

function Get-SendKeysSteps([string]$s, [int[]]$held) {
  if ($null -eq $held) { $held = [int[]]@() }
  $steps = New-Object System.Collections.Generic.List[object]
  $pending = New-Object 'System.Collections.Generic.List[int]'
  $i = 0
  while ($i -lt $s.Length) {
    $ch = $s[$i]
    $mod = Get-SendKeysModifier $ch
    if ($mod -ne 0) {
      [void]$pending.Add($mod)
      $i++
      if ($i -lt $s.Length -and $s[$i] -eq '(') {
        $close = Get-SendKeysGroupEnd $s $i
        $inner = $s.Substring($i + 1, $close - $i - 1)
        $nextHeld = Join-KeyMods $held $pending
        $pending.Clear()
        foreach ($st in (Get-SendKeysSteps $inner $nextHeld)) { [void]$steps.Add($st) }
        $i = $close + 1
      }
      continue
    }
    if ($ch -eq '(') {
      $close = Get-SendKeysGroupEnd $s $i
      $inner = $s.Substring($i + 1, $close - $i - 1)
      $nextHeld = Join-KeyMods $held $pending
      $pending.Clear()
      foreach ($st in (Get-SendKeysSteps $inner $nextHeld)) { [void]$steps.Add($st) }
      $i = $close + 1
      continue
    }
    if ($ch -eq ')') { throw 'Tuş dizisinde fazla kapanan parantez.' }
    $mods = Join-KeyMods $held $pending
    $pending.Clear()
    if ($ch -eq '~') {
      [void]$steps.Add([pscustomobject]@{ kind = 'vk'; vk = 0x0D; mods = $mods; times = 1 })
      $i++
      continue
    }
    if ($ch -eq '{') {
      $tok = Read-SendKeysBrace $s $i
      $i = [int]$tok.next
      if ($tok.kind -eq 'char') {
        [void]$steps.Add([pscustomobject]@{ kind = 'char'; char = [string]$tok.char; mods = $mods; times = [int]$tok.times })
      } else {
        [void]$steps.Add([pscustomobject]@{ kind = 'vk'; vk = [int]$tok.vk; mods = $mods; times = [int]$tok.times })
      }
      continue
    }
    [void]$steps.Add([pscustomobject]@{ kind = 'char'; char = [string]$ch; mods = $mods; times = 1 })
    $i++
  }
  if ($pending.Count -eq 1) {
    [void]$steps.Add([pscustomobject]@{ kind = 'vk'; vk = [int]$pending[0]; mods = (Join-KeyMods $held $null); times = 1 })
  } elseif ($pending.Count -gt 1) {
    [void]$steps.Add([pscustomobject]@{ kind = 'mods'; mods = (Join-KeyMods $held $pending); times = 1 })
  }
  return ,$steps
}

function Resolve-SendKeysChar([string]$text) {
  if ([string]::IsNullOrEmpty($text)) { throw 'Tuş boş.' }
  $ch = [char]$text[0]
  if ($ch -ge 'a' -and $ch -le 'z') {
    return [pscustomobject]@{ vk = [int]([char]::ToUpperInvariant($ch)); extra = ([int[]]@()) }
  }
  if ($ch -ge 'A' -and $ch -le 'Z') {
    return [pscustomobject]@{ vk = [int]$ch; extra = ([int[]]@(0x10)) }
  }
  if ($ch -ge '0' -and $ch -le '9') {
    return [pscustomobject]@{ vk = [int]$ch; extra = ([int[]]@()) }
  }
  if ($ch -eq ' ') {
    return [pscustomobject]@{ vk = 0x20; extra = ([int[]]@()) }
  }
  $packed = [XpInput]::ScanChar($ch)
  if ($packed -lt 0) { throw "Bu klavye düzeninde üretilemeyen karakter: $text" }
  $vk = $packed -band 0xFF
  $state = [int](($packed -band 0xFF00) / 256)
  $extra = New-Object 'System.Collections.Generic.List[int]'
  if (($state -band 1) -ne 0) { $extra.Add(0x10) }
  if (($state -band 2) -ne 0) { $extra.Add(0x11) }
  if (($state -band 4) -ne 0) { $extra.Add(0x12) }
  return [pscustomobject]@{ vk = $vk; extra = ([int[]]$extra.ToArray()) }
}

function Send-ParsedKey($step) {
  $mods = New-Object 'System.Collections.Generic.List[int]'
  foreach ($m in @($step.mods)) {
    if ($null -eq $m) { continue }
    $mv = [int]$m
    if (-not $mods.Contains($mv)) { $mods.Add($mv) }
  }
  if ($step.kind -eq 'mods') {
    [XpInput]::Chord([int[]]$mods.ToArray(), 0, 1)
    return
  }
  $times = 1
  if ($null -ne $step.times) { $times = [int]$step.times }
  if ($times -lt 1) { $times = 1 }
  $vk = 0
  if ($step.kind -eq 'char') {
    $resolved = Resolve-SendKeysChar ([string]$step.char)
    $vk = [int]$resolved.vk
    foreach ($m in @($resolved.extra)) {
      if ($null -eq $m) { continue }
      $mv = [int]$m
      if (-not $mods.Contains($mv)) { $mods.Add($mv) }
    }
  } else {
    $vk = [int]$step.vk
  }
  [XpInput]::Chord([int[]]$mods.ToArray(), $vk, $times)
}

function Test-PlainKey([string]$name) {
  $words = @('ctrl', 'control', 'shift', 'alt', 'win', 'enter', 'return', 'esc', 'escape', 'tab', 'up', 'down', 'left', 'right', 'space', 'backspace', 'delete', 'del', 'home', 'end', 'pageup', 'pagedown', 'insert')
  if ($words -contains $name) { return $true }
  if ($name.Length -eq 1) {
    $c = [char]$name[0]
    if (($c -ge 'a' -and $c -le 'z') -or ($c -ge '0' -and $c -le '9')) { return $true }
  }
  if ($name -match '^f(1[0-9]|2[0-4]|[1-9])$') { return $true }
  return $false
}

# ctrl+s, win+r, alt+f4, enter. A single unknown word is left for SendKeys to type.
function Get-PlainChord([string]$keys) {
  if ([string]::IsNullOrWhiteSpace($keys)) { return $null }
  $t = $keys.Trim().ToLowerInvariant()
  if ($t -notmatch '^[a-z0-9+\s]+$') { return $null }
  $parts = @($t.Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
  if ($parts.Count -eq 0) { return $null }
  foreach ($p in $parts) {
    if (-not (Test-PlainKey $p)) {
      if ($parts.Count -eq 1) { return $null }
      throw "Tuş tanınmadı: $p"
    }
  }
  return ,$parts
}

function Send-KeyString([string]$keys) {
  $plain = Get-PlainChord $keys
  if ($null -ne $plain) {
    $err = [XpInput]::Combo([string[]]$plain)
    if ($err) { throw $err }
    return
  }
  if (-not (Test-SendKeysHasWin $keys)) {
    [System.Windows.Forms.SendKeys]::SendWait([string]$keys)
    return
  }
  $steps = Get-SendKeysSteps $keys ([int[]]@())
  foreach ($step in $steps) { Send-ParsedKey $step }
}

if (-not ('XpWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class XpWin {
  [StructLayout(LayoutKind.Sequential)] public struct GUIINFO {
    public int cbSize, flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public int left, top, right, bottom;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  public static IntPtr FocusHandle() {
    var foreground = GetForegroundWindow();
    if (foreground == IntPtr.Zero) return IntPtr.Zero;
    var info = new GUIINFO(); info.cbSize = Marshal.SizeOf(typeof(GUIINFO));
    return GetGUIThreadInfo(GetWindowThreadProcessId(foreground, IntPtr.Zero), ref info) ? info.hwndFocus : IntPtr.Zero;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lp, int nMax);
  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(256);
    if (h == IntPtr.Zero) return "";
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeout")]
  public static extern IntPtr SendMessageTimeoutPtr(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  // EM_SETSEL 0..-1: select all text of a classic Edit control, for boxes that ignore Ctrl+A. False when it did not answer in time.
  public static bool SelectAll(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    IntPtr r;
    return SendMessageTimeoutPtr(h, 0x00B1, IntPtr.Zero, new IntPtr(-1), 2, 500, out r) != IntPtr.Zero;
  }
  // The text of a classic Edit control, or null when it cannot be read in time (the app is hung) or is too long.
  public static string ReadText(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    IntPtr len;
    if (SendMessageTimeout(h, 0x000E, IntPtr.Zero, null, 2, 500, out len) == IntPtr.Zero) return null;
    int n = len.ToInt32();
    if (n < 0 || n > 32768) return null;
    var sb = new StringBuilder(n + 2);
    IntPtr got;
    if (SendMessageTimeout(h, 0x000D, (IntPtr)(n + 1), sb, 2, 500, out got) == IntPtr.Zero) return null;
    return sb.ToString();
  }
}
"@
}

function Test-TextLike($el) {
  if ($null -eq $el) { return $false }
  try { if (-not $el.Current.IsEnabled -or $el.Current.IsOffscreen) { return $false } } catch { return $false }
  $vp = $null
  try {
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { return (-not $vp.Current.IsReadOnly) }
    if (@('Edit', 'ComboBox') -contains (Get-CT $el)) { return [bool]$el.Current.IsKeyboardFocusable }
    # Some native edit providers expose a Pane instead of an Edit. Use the
    # exact child's HWND, not the class of an arbitrary ancestor window.
    $h = [IntPtr]$el.Current.NativeWindowHandle
    if ($h -ne [IntPtr]::Zero -and [XpWin]::ClassOf($h) -match '^(Edit|RichEdit.*)$') {
      return (([XpWin]::GetWindowLong($h, -16) -band 0x800) -eq 0)
    }
  } catch {}
  return $false
}

function Get-InputFocus {
  # UIA can report the dialog Pane while its native child owns keyboard focus.
  try {
    $h = [XpWin]::FocusHandle()
    if ($h -ne [IntPtr]::Zero) {
      $native = $script:AE::FromHandle($h)
      if (Test-TextLike $native) { return $native }
    }
  } catch {}
  try { return $script:AE::FocusedElement } catch { return $null }
}

$script:TypeChoiceCache = @{}

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
  $all = @(Get-TextCandidates $win 12)
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

# The window class of this very element (a classic Win32 control), not of an ancestor.
function Get-OwnNativeClass($el) {
  try {
    $h = [IntPtr]$el.Current.NativeWindowHandle
    if ($h -eq [IntPtr]::Zero) { return '' }
    return [XpWin]::ClassOf($h)
  } catch { return '' }
}

# A short caption: UIA Text, or a classic Static control that UIA reports as a Pane.
function Test-LabelLike($el) {
  if ($null -eq $el) { return $false }
  return ((Get-CT $el) -eq 'Text') -or ((Get-OwnNativeClass $el) -eq 'Static')
}

# The real text of a classic Win32 edit box that offers no ValuePattern (UIA reports it as a Pane).
# Null when it cannot be read: not an edit box, a password box, too long, or the app did not answer in time.
function Get-NativeEditText($el) {
  try {
    $h = [IntPtr]$el.Current.NativeWindowHandle
    if ($h -eq [IntPtr]::Zero) { return $null }
    if ([XpWin]::ClassOf($h) -notmatch '^(Edit|RichEdit.*)$') { return $null }
    if (([XpWin]::GetWindowLong($h, -16) -band 0x20) -ne 0) { return $null }
    return [XpWin]::ReadText($h)
  } catch { return $null }
}

# The field's current text, or null when it cannot be read (unknown is not the same as empty).
function Get-FieldValue($el) {
  $vp = $null
  try {
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $v = [string]$vp.Current.Value
      if ($v.Length -gt 80) { return $v.Substring(0, 80) }
      return $v
    }
  } catch {}
  $native = Get-NativeEditText $el
  if ($null -eq $native) { return $null }
  if ($native.Length -gt 80) { return $native.Substring(0, 80) }
  return $native
}

# Short captions in a window, with their rectangles.
function Get-Labels($root) {
  $out = New-Object System.Collections.ArrayList
  if ($null -eq $root) { return @() }
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue(@{ el = $root; d = 0 })
  $seen = 0
  while ($queue.Count -gt 0 -and $seen -lt 500) {
    $pair = $queue.Dequeue()
    $el = $pair.el
    $d = [int]$pair.d
    $seen++
    if ($d -gt 0 -and (Test-LabelLike $el)) {
      try {
        $name = [string]$el.Current.Name
        $r = $el.Current.BoundingRectangle
        if ($name -and -not $r.IsEmpty -and $r.Width -gt 0 -and $r.Width -lt 400 -and $r.Height -lt 80) {
          [void]$out.Add([pscustomobject]@{ name = $name; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height })
        }
      } catch {}
    }
    if ($d -ge 12) { continue }
    $child = $null
    try { $child = $script:Walker.GetFirstChild($el) } catch {}
    while ($null -ne $child) {
      $queue.Enqueue(@{ el = $child; d = ($d + 1) })
      try { $child = $script:Walker.GetNextSibling($child) } catch { break }
    }
  }
  return @($out)
}

# The caption on the same row, immediately left of the field: at most 120 px away, on the same row within 16 px.
function Find-FieldLabel($labels, $rect) {
  $best = $null
  $bestGap = [double]::MaxValue
  foreach ($l in @($labels)) {
    $gap = $rect.X - ($l.x + $l.w)
    if ($gap -lt -4 -or $gap -ge 120) { continue }
    if ([Math]::Abs(($rect.Y + $rect.Height / 2) - ($l.y + $l.h / 2)) -ge 16) { continue }
    if ($gap -lt $bestGap) { $best = $l; $bestGap = $gap }
  }
  return $best
}

function Test-PointInside($el, [int]$x, [int]$y) {
  if ($x -eq 0 -and $y -eq 0) { return $false }
  try {
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty) { return $false }
    return ($x -ge $r.X -and $x -le ($r.X + $r.Width) -and $y -ge $r.Y -and $y -le ($r.Y + $r.Height))
  } catch { return $false }
}

# Writable fields in the foreground window, with retained selection identities.
function Get-TypeChoices([int]$ownPid, [int]$x, [int]$y) {
  $out = New-Object System.Collections.ArrayList
  $id = 0
  $root = $null
  try { $root = $script:AE::FromHandle([XpWin]::GetForegroundWindow()) } catch {}
  # A type step stays in the active dialog. It must not overwrite an unrelated
  # app because that app happened to have the only discoverable input.
  if ($null -eq $root) { return @() }
  $point = $null
  if ($x -ne 0 -or $y -ne 0) {
    try { $point = $script:AE::FromPoint((New-Object System.Windows.Point($x, $y))) } catch {}
  }
  foreach ($w in @($root)) {
    if (-not (Test-UsableWindow $w)) { continue }
    try { if ([int]$w.Current.ProcessId -eq $ownPid) { continue } } catch { continue }
    $title = ''
    try { $title = [string]$w.Current.Name } catch {}
    if (-not $title) { continue }
    $mine = @()
    foreach ($el in @(Get-OwnInputs $w)) {
      $id++
      $name = ''
      try { $name = [string]$el.Current.Name } catch {}
      $related = $false
      if ($null -ne $point) {
        try { $related = Test-Same $el.Current.LabeledBy $point } catch {}
        # A small caption on the same row can name the immediately adjacent box.
        try {
          $lr = $point.Current.BoundingRectangle
          $er = $el.Current.BoundingRectangle
          if ((Test-LabelLike $point) -and $lr.Width -lt 400 -and $lr.Height -lt 80 -and
              $er.X -ge ($lr.X + $lr.Width - 4) -and $er.X - ($lr.X + $lr.Width) -lt 120 -and
              [Math]::Abs(($er.Y + $er.Height / 2) - ($lr.Y + $lr.Height / 2)) -lt 16) { $related = $true }
        } catch {}
      }
      $token = [Guid]::NewGuid().ToString('N')
      $script:TypeChoiceCache[$token] = $el
      $v = Get-FieldValue $el
      $entry = [pscustomobject]@{
        id = $id
        token = $token
        window = $title
        type = (Get-CT $el)
        native = (Get-OwnNativeClass $el)
        name = $name
        value = [string]$v
        valueKnown = ($null -ne $v)
        label = ''
        clicked = (Test-PointInside $el $x $y)
        related = $related
        el = $el
      }
      [void]$out.Add($entry)
      $mine += $entry
    }
    # With several fields to tell apart, name each by the caption on its row. Clicking that caption points at its
    # field even when UIA gives the caption no Text type and no LabeledBy link (classic Win32 forms).
    if ($mine.Count -ge 2) {
      $labels = @(Get-Labels $w)
      foreach ($entry in $mine) {
        $lbl = $null
        try { $lbl = Find-FieldLabel $labels $entry.el.Current.BoundingRectangle } catch {}
        if ($null -eq $lbl) { continue }
        $entry.label = $lbl.name
        if (($x -ne 0 -or $y -ne 0) -and $x -ge ($lbl.x - 3) -and $x -le ($lbl.x + $lbl.w + 3) -and $y -ge ($lbl.y - 3) -and $y -le ($lbl.y + $lbl.h + 3)) { $entry.related = $true }
      }
    }
  }
  return @($out)
}

function Test-InputFocus($focus, $field) {
  $p = $focus
  for ($i = 0; $i -lt 8 -and $null -ne $p; $i++) {
    if (Test-Same $p $field) { return $true }
    try { $p = $script:Walker.GetParent($p) } catch { break }
  }
  return $false
}

function Focus-Input($el) {
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 150
  if (Test-InputFocus (Get-InputFocus) $el) { return $true }
  # A provider can omit SetFocus while its visible edit still accepts clicks.
  try {
    $r = $el.Current.BoundingRectangle
    if (-not $r.IsEmpty -and $r.Width -gt 0 -and $r.Height -gt 0) {
      Invoke-MouseAt ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2)) 'left'
      Start-Sleep -Milliseconds 150
    }
  } catch {}
  return (Test-InputFocus (Get-InputFocus) $el)
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
  if (-not (Focus-Input $holder)) { throw 'Yazı alanı odağı alamadı; yazı gönderilmedi.' }
  try { $vp.SetValue($text) } catch { return $false }
  $value = $null
  try { $value = [string]$vp.Current.Value } catch {}
  return [pscustomobject]@{ value = $value }
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
      $out = [ordered]@{ cleared = $false; skippedClear = $false; pasted = $false; focusType = ''; rescued = $false; where = ''; via = ''; needChoice = $false; choices = @(); value = $null }
      $focus = Get-InputFocus
      if ($null -ne $focus) { $out.focusType = Get-CT $focus }
      $atX = 0
      $atY = 0
      if ($P.x) { $atX = [int]$P.x }
      if ($P.y) { $atY = [int]$P.y }
      $ownPid = 0
      if ($P.ownPid) { $ownPid = [int]$P.ownPid }
      $picked = $null
      if ($P.fieldToken) {
        $token = [string]$P.fieldToken
        if (-not $script:TypeChoiceCache.ContainsKey($token)) { throw 'Seçilen yazı alanı artık geçerli değil; yazı gönderilmedi.' }
        $el = $script:TypeChoiceCache[$token]
        $script:TypeChoiceCache.Clear()
        if (-not (Test-TextLike $el)) { throw 'Seçilen yazı alanı kapandı veya yazı kabul etmiyor; yazı gönderilmedi.' }
        $top = Get-TopLevel $el
        $front = $script:AE::FromHandle([XpWin]::GetForegroundWindow())
        if (-not (Test-Same $top $front)) { throw 'Seçim sırasında öndeki pencere değişti; yazı gönderilmedi.' }
        $picked = [pscustomobject]@{ el = $el; window = [string]$top.Current.Name; type = (Get-CT $el) }
      } elseif ($P.clearFirst -and (($atX -ne 0 -or $atY -ne 0) -or -not (Test-TextLike $focus))) {
        $script:TypeChoiceCache.Clear()
        $choices = @(Get-TypeChoices $ownPid $atX $atY)
        $public = @($choices | ForEach-Object { [pscustomobject]@{ id = $_.id; token = $_.token; window = $_.window; type = $_.type; native = $_.native; name = $_.name; value = $_.value; valueKnown = $_.valueKnown; label = $_.label; clicked = $_.clicked; related = $_.related } })
        $hit = @($choices | Where-Object { $_.clicked -or $_.related })
        if ($hit.Count -eq 1) {
          $picked = $hit[0]
        } elseif ($choices.Count -eq 1) {
          $picked = $choices[0]
        } elseif ($choices.Count -gt 1) {
          $out.needChoice = $true
          $out.choices = $public
          return [pscustomobject]$out
        }
      }
      if ($null -ne $picked) {
        $out.where = [string]$picked.window
        $result = if ($P.clearFirst) { Set-TextValue $picked.el ([string]$P.text) } else { $false }
        if ($result) {
          $out.rescued = $true
          $out.where = [string]$picked.window
          $out.via = 'value'
          $out.focusType = [string]$picked.type
          $out.cleared = $true
          $out.value = $result.value
          if ($P.pressEnter) {
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          }
          return [pscustomobject]$out
        }
        # A writable field without ValuePattern still supports normal typing.
        if (-not (Focus-Input $picked.el)) { throw 'Seçilen yazı alanı odaklanamadı; yazı gönderilmedi.' }
        $focus = Get-InputFocus
        if (-not (Test-InputFocus $focus $picked.el)) { throw 'Seçilen yazı alanı odağı alamadı; yazı gönderilmedi.' }
        $out.focusType = Get-CT $focus
      }
      try { $out.where = [string](Get-TopLevel $focus).Current.Name } catch {}
      if ($P.clearFirst) {
        # Ctrl+A / Delete only inside a text field; elsewhere it would select and delete the app's content.
        if (Test-TextLike $focus) {
          Start-Sleep -Milliseconds 120
          [System.Windows.Forms.SendKeys]::SendWait('^a')
          Start-Sleep -Milliseconds 280
          [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
          Start-Sleep -Milliseconds 200
          # Some classic edit boxes ignore Ctrl+A. If the box still holds text, select it with EM_SETSEL and delete again.
          # Only a box whose text can be read is touched, so where Ctrl+A works nothing changes.
          $left = Get-NativeEditText $focus
          if ($null -ne $left -and $left.Length -gt 0) {
            $hwnd = [IntPtr]0
            try { $hwnd = [IntPtr]$focus.Current.NativeWindowHandle } catch {}
            if ([XpWin]::SelectAll($hwnd)) {
              Start-Sleep -Milliseconds 120
              [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
              Start-Sleep -Milliseconds 200
            }
          }
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
      $vp = $null
      try {
        if ($null -ne $focus -and $focus.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $out.value = [string]$vp.Current.Value }
      } catch {}
      # A classic Win32 edit box has no ValuePattern; read what it really holds so the write can be verified.
      if ($null -eq $out.value -and $null -ne $focus) {
        $native = Get-NativeEditText $focus
        if ($null -ne $native) { $out.value = $native }
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
      Send-KeyString ([string]$P.keys)
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
      $el = Get-InputFocus
      if ($null -eq $el) { return $null }
      $vp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
        return [pscustomobject]@{ value = [string]$vp.Current.Value; type = (Get-CT $el) }
      }
      $native = Get-NativeEditText $el
      if ($null -ne $native) { return [pscustomobject]@{ value = $native; type = (Get-CT $el) } }
      return $null
    }
    'inputState' {
      $el = Get-InputFocus
      if ($null -eq $el) { return $null }
      $name = ''; $title = ''
      try { $name = [string]$el.Current.Name; $title = [string](Get-TopLevel $el).Current.Name } catch {}
      return [pscustomobject]@{ type = (Get-CT $el); writable = (Test-TextLike $el); name = $name; window = $title }
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
