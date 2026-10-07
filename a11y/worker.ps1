# Long-running automation worker.
# Request line:  <id>\t<op>\t<base64 utf8 json payload>
# Response line: <id>\t<base64 utf8 json {ok,data|error}>

. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'screen.ps1')

function ConvertTo-SendKeysText([string]$t) {
  return ($t -replace '([\+\^%~\(\)\{\}\[\]])', '{$1}')
}

# CapsLock is a global key: the worker must not toggle it, it must type around it. A failure to
# read it means "unknown", and unknown is treated as off, which is what the rest of the worker
# assumes anyway.
function Get-CapsLock {
  try { return [bool][System.Windows.Forms.Control]::IsKeyLocked('CapsLock') } catch { return $false }
}

# SendKeys presses Shift for an upper case letter and none for a lower case one, and it never
# looks at CapsLock. With CapsLock on, the physical result is therefore flipped, so the case is
# flipped back before handing the character over: the screen then shows what the flow asked for.
function Switch-TextCase([string]$t) {
  if ([string]::IsNullOrEmpty($t)) { return $t }
  $ch = [char]$t[0]
  if ($ch -ge 'a' -and $ch -le 'z') { return [string][char]::ToUpperInvariant($ch) }
  if ($ch -ge 'A' -and $ch -le 'Z') { return [string][char]::ToLowerInvariant($ch) }
  return $t
}

function Send-TextPaced([string]$t, [int]$gapMs, [scriptblock]$checkFocus = $null) {
  if ([string]::IsNullOrEmpty($t)) { return }
  $caps = Get-CapsLock
  foreach ($ch in $t.ToCharArray()) {
    if ($null -ne $checkFocus) { & $checkFocus }
    $out = if ($caps) { Switch-TextCase ([string]$ch) } else { [string]$ch }
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysText $out))
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

function Resolve-ParsedKey($step) {
  $mods = New-Object 'System.Collections.Generic.List[int]'
  foreach ($m in @($step.mods)) {
    if ($null -eq $m) { continue }
    $mv = [int]$m
    if (-not $mods.Contains($mv)) { $mods.Add($mv) }
  }
  if ($step.kind -eq 'mods') {
    return [pscustomobject]@{ mods = [int[]]$mods.ToArray(); vk = 0; times = 1 }
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
  return [pscustomobject]@{ mods = [int[]]$mods.ToArray(); vk = $vk; times = $times }
}

function Test-PlainModifier([string]$name) {
  return @('ctrl', 'control', 'shift', 'alt', 'win', 'lwin', 'rwin', 'meta', 'cmd', 'super') -contains $name
}

function Test-PlainKey([string]$name) {
  if (Test-PlainModifier $name) { return $true }
  $words = @('enter', 'return', 'esc', 'escape', 'tab', 'up', 'down', 'left', 'right', 'space', 'backspace', 'delete', 'del', 'home', 'end', 'pageup', 'pagedown', 'insert',
    'arrowleft', 'arrowup', 'arrowright', 'arrowdown', 'capslock', 'printscreen', 'minus', 'plus', 'comma', 'period', 'slash',
    'numpad0', 'numpad1', 'numpad2', 'numpad3', 'numpad4', 'numpad5', 'numpad6', 'numpad7', 'numpad8', 'numpad9')
  if ($words -contains $name) { return $true }
  if ($name.Length -eq 1) {
    $c = [char]$name[0]
    if (($c -ge 'a' -and $c -le 'z') -or ($c -ge '0' -and $c -le '9')) { return $true }
  }
  if ($name -match '^f(1[0-9]|2[0-4]|[1-9])$') { return $true }
  return $false
}

# Only named keys or a NAMED leading modifier opt in to the new syntax.
# +a, A, a+b and every other legacy string must not be split, lowercased or rewritten.
function Get-PlainChord([string]$keys) {
  if ([string]::IsNullOrWhiteSpace($keys)) { return $null }
  $t = $keys.Trim().ToLowerInvariant()
  $plus = $t.IndexOf('+')
  if ($plus -lt 0) {
    if ($t.Length -le 1 -or -not (Test-PlainKey $t)) { return $null }
    return ,([string[]]@($t))
  }
  $first = $t.Substring(0, $plus).Trim()
  if (-not (Test-PlainModifier $first)) { return $null }
  # Preserve empty pieces so a typo such as ctrl++s cannot silently become ctrl+s.
  $parts = @($t.Split('+') | ForEach-Object { $_.Trim() })
  # The Win button leaves a prefix in the field; executing that one prefix taps Windows.
  if ($parts.Count -eq 2 -and $parts[1] -eq '' -and @('win', 'lwin', 'rwin', 'meta', 'cmd', 'super') -contains $first) {
    return ,([string[]]@($first))
  }
  foreach ($p in $parts) {
    if ($p.Length -eq 0) { throw 'Kısayolda boş tuş var. Örn: win+r veya ctrl+s.' }
    if (-not (Test-PlainKey $p)) {
      throw "Tuş tanınmadı: $p"
    }
  }
  for ($i = 0; $i -lt $parts.Count - 1; $i++) {
    if (-not (Test-PlainModifier $parts[$i])) { throw 'Kısayolda Ctrl/Alt/Shift/Win önce, hedef tuş en sonda olmalı.' }
  }
  if (Test-PlainModifier $parts[$parts.Count - 1]) { throw 'Kısayolun sonunda hedef tuş eksik.' }
  return ,([string[]]$parts)
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
  # Resolve the entire Windows sequence before sending any input. A later invalid
  # character must not leave the earlier part of a shortcut already executed.
  $ready = New-Object System.Collections.Generic.List[object]
  foreach ($step in $steps) { [void]$ready.Add((Resolve-ParsedKey $step)) }
  foreach ($step in $ready) { [XpInput]::Chord([int[]]$step.mods, [int]$step.vk, [int]$step.times) }
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
  [StructLayout(LayoutKind.Sequential)] public class RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
  public static bool IsOwnedBy(IntPtr h, IntPtr owner) {
    for (int i = 0; i < 16 && h != IntPtr.Zero; i++) {
      h = GetWindow(h, 4);
      if (h == owner) return true;
    }
    return false;
  }
  [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] static extern uint ThreadAndPid(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, [Out] RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public static int ProcessOf(IntPtr h) { uint pid; ThreadAndPid(h, out pid); return (int)pid; }
  public static IntPtr RootOf(IntPtr h) { return h == IntPtr.Zero ? h : GetAncestor(h, 2); }
  public static IntPtr RootAt(int x, int y) { return RootOf(WindowFromPoint(new POINT { x = x, y = y })); }
  public static GUIINFO FocusData() {
    var info = new GUIINFO(); info.cbSize = Marshal.SizeOf(typeof(GUIINFO));
    var fg = GetForegroundWindow();
    if (fg == IntPtr.Zero || !GetGUIThreadInfo(GetWindowThreadProcessId(fg, IntPtr.Zero), ref info)) throw new InvalidOperationException("No keyboard focus information");
    return info;
  }
  public static RECT BoundsOf(IntPtr h) { var r = new RECT(); return GetWindowRect(h, r) ? r : null; }
  public static RECT CaretBounds(GUIINFO info) {
    var p = new POINT { x = info.left, y = info.top };
    if (info.hwndCaret == IntPtr.Zero || !ClientToScreen(info.hwndCaret, ref p)) return null;
    return new RECT { left = p.x, top = p.y, right = p.x + info.right - info.left, bottom = p.y + info.bottom - info.top };
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
  $native = $null
  try {
    $h = [XpWin]::FocusHandle()
    if ($h -ne [IntPtr]::Zero) {
      $native = $script:AE::FromHandle($h)
      if (Test-TextLike $native) { return $native }
    }
  } catch {}
  $uia = $null
  try { $uia = $script:AE::FocusedElement } catch {}
  if (Test-TextLike $uia) { return $uia }
  # Keep the native child even if its provider cannot report editability.
  # This is evidence for diagnostics/recovery, NOT permission to type.
  if ($null -ne $native) { return $native }
  return $uia
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

function Focus-Input($el, $guard = $null) {
  if ($guard) { [void](Get-BoundWindow $guard.window $false) }
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 150
  if (Test-InputFocus (Get-InputFocus) $el) { return $true }
  # A provider can omit SetFocus while its visible edit still accepts clicks.
  try {
    $r = $el.Current.BoundingRectangle
    if (-not $r.IsEmpty -and $r.Width -gt 0 -and $r.Height -gt 0) {
      $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
      if ($guard) {
        [void](Get-BoundWindow $guard.window $false)
        if ([XpWin]::RootAt($x, $y) -ne [IntPtr]([long]$guard.window.hwnd)) { throw 'INPUT_CLICK_OCCLUDED: Field is covered' }
      }
      Invoke-MouseAt $x $y 'left'
      Start-Sleep -Milliseconds 150
    }
  } catch {}
  return (Test-InputFocus (Get-InputFocus) $el)
}

function Set-TextValue($el, [string]$text, $guard = $null) {
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
  if (-not (Focus-Input $holder $guard)) { throw 'Yazı alanı odağı alamadı; yazı gönderilmedi.' }
  if ($guard) { [void](Get-BoundWindow $guard.window $false); Assert-TypeFocus $holder $guard ([string][XpWin]::FocusHandle()) }
  try { $vp.SetValue($text) } catch {
    if ($guard) { throw 'INPUT_WRITE_UNCERTAIN: ValuePattern write failed; no automatic input replay' }
    return $false
  }
  $value = $null
  try { $value = [string]$vp.Current.Value } catch {}
  return [pscustomobject]@{ value = $value }
}

# Identity guards use an exact live HWND/PID, never a title-only exception.
# A shortcut that presses the Windows key acts on the system, not on the target
# application: win+d shows the desktop, win+tab opens Task View, win+r opens Run. Those
# must still be sent when the target window is no longer in front. Anything unparseable is
# also left alone, so Send-KeyString can report the real error.
function Test-SystemShortcut([string]$keys) {
  if ([string]::IsNullOrWhiteSpace($keys)) { return $true }
  $plain = $null
  try { $plain = Get-PlainChord $keys } catch { return $true }
  if ($null -ne $plain) {
    # A braced form such as {WIN}d is the SendKeys domain; that classifier reads braces and
    # carries a Windows key over to the next chord, so it decides those.
    if ($keys.Contains('{')) { try { return [bool](Test-SendKeysSystemOnly $keys) } catch { return $false } }
    # A plain command may hold more than one chord. Only a command whose every chord presses
    # a Windows key is a system shortcut, or "win+r ctrl+s" would carry the ctrl+s past the guard.
    foreach ($chord in @([string]$keys -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
      $got = $null
      try { $got = Get-PlainChord $chord } catch { return $true }
      # Get-PlainChord wraps its answer, so flatten it here instead of relying on unrolling.
      $tokens = @()
      foreach ($item in @($got)) {
        if ($item -is [System.Array]) { $tokens += @($item) } else { $tokens += [string]$item }
      }
      $isWin = $false
      foreach ($t in $tokens) {
        $name = ([string]$t).Trim().ToLowerInvariant()
        if ($name.StartsWith('{') -and $name.EndsWith('}')) { $name = $name.Substring(1, $name.Length - 2) }
        if ($name -eq '#' -or @('win', 'lwin', 'rwin', 'meta', 'cmd', 'super') -contains $name) { $isWin = $true }
      }
      if (-not $isWin) { return $false }
    }
    return $true
  }
  try { return [bool](Test-SendKeysSystemOnly $keys) } catch { return $false }
}

# A legacy SendKeys string may hold more than one chord. Only one in which every chord presses
# a Windows key is a system shortcut: in "#r^s" the ^s must still face the window guard.
function Test-SendKeysSystemOnly([string]$keys) {
  if ([string]::IsNullOrEmpty($keys)) { return $false }
  $chords = [regex]::Matches($keys, '[%^+#]*(?:\{[^}]*\}|.)')
  if ($chords.Count -eq 0) { return $false }
  $carry = $false
  foreach ($m in $chords) {
    $chord = $m.Value
    $keyPart = $chord -replace '^[%^+#]*', ''
    $isWinKey = $keyPart -match '^\{(WIN|LWIN|RWIN)\}$'
    if (-not ($carry -or $chord.StartsWith('#') -or $isWinKey)) { return $false }
    $carry = $isWinKey
  }
  return $true
}

# Keys land in whatever window is in front, so a shortcut meant for the target application
# must not be sent while another program holds the foreground. A window of the same process
# counts as the same application: Blender's save window is still Blender, and a shortcut
# meant for Blender belongs there.
function Assert-KeyWindowActive($win) {
  $fg = [XpWin]::GetForegroundWindow()
  if ($fg -eq [IntPtr]::Zero) { throw 'INPUT_WINDOW_NOT_ACTIVE: No window is in front; the shortcut was not sent' }
  $h = [IntPtr]$win.Current.NativeWindowHandle
  if ($fg -eq $h) { return }
  $targetPid = 0
  try { $targetPid = [int]$win.Current.ProcessId } catch { $targetPid = 0 }
  if ($targetPid -gt 0 -and [XpWin]::ProcessOf($fg) -eq $targetPid) { return }
  throw 'INPUT_WINDOW_NOT_ACTIVE: Another program is in front; the shortcut was not sent'
}

function Get-BoundWindow($target, [bool]$activate = $false) {
  if (-not $target -or -not $target.hwnd -or -not $target.pid) { throw 'INPUT_TARGET_INVALID: Missing window identity' }
  $h = [IntPtr]([long]$target.hwnd)
  if (-not [XpWin]::IsWindow($h) -or [XpWin]::ProcessOf($h) -ne [int]$target.pid) { throw 'INPUT_WINDOW_CLOSED: Target window identity changed' }
  $el = $script:AE::FromHandle($h)
  if ($null -eq $el) { throw 'INPUT_TARGET_INVALID: Target window cannot be inspected' }
  if ($activate) { Enter-Window $el }
  if ([XpWin]::GetForegroundWindow() -ne $h) { throw 'INPUT_WINDOW_NOT_ACTIVE: Target window did not take foreground focus' }
  if (-not $activate -and $target.rect) {
    $r = $el.Current.BoundingRectangle
    if ([int]$r.X -ne $target.rect.x -or [int]$r.Y -ne $target.rect.y -or [int]$r.Width -ne $target.rect.w -or [int]$r.Height -ne $target.rect.h) {
      throw 'INPUT_LAYOUT_CHANGED: Window bounds changed; stale coordinates were not used'
    }
  }
  # This is the window the run is working on, so a later key with no window title is checked here.
  $script:LastKeyWindow = $el
  return $el
}

function Get-InputTarget($P) {
  $el = $null
  if ($P.target) {
    $original = [IntPtr]([long]$P.target.hwnd)
    if (-not [XpWin]::IsWindow($original) -or [XpWin]::ProcessOf($original) -ne [int]$P.target.pid) { throw 'INPUT_WINDOW_CLOSED: Target window identity changed' }
    $fg = [XpWin]::GetForegroundWindow()
    if ($P.followOwnedDialog -and [XpWin]::ProcessOf($fg) -eq [int]$P.target.pid -and [XpWin]::IsOwnedBy($fg, $original)) {
      $el = $script:AE::FromHandle($fg)
    } else { $el = Get-BoundWindow $P.target $true }
  } elseif ($P.windowTitle) {
    $el = Find-Window ([string]$P.windowTitle)
    Enter-Window $el
  } elseif ($P.at) {
    $h = [XpWin]::RootAt([int]$P.at.x, [int]$P.at.y)
    if ($h -ne [IntPtr]::Zero) { $el = $script:AE::FromHandle($h) }
    if ($null -ne $el) { Enter-Window $el }
  } else {
    $el = $script:AE::FromHandle([XpWin]::GetForegroundWindow())
  }
  if ($null -eq $el) { throw 'INPUT_TARGET_INVALID: No target window' }
  $h = [IntPtr]$el.Current.NativeWindowHandle
  $targetPid = [int]$el.Current.ProcessId
  if ($P.ownPid -and $targetPid -eq [int]$P.ownPid) { throw 'INPUT_TARGET_INVALID: Nubbo cannot be its own input target' }
  if ($h -eq [IntPtr]::Zero -or [XpWin]::GetForegroundWindow() -ne $h) { throw 'INPUT_WINDOW_NOT_ACTIVE: Target window did not take foreground focus' }
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0) { throw 'INPUT_TARGET_INVALID: Target window has no visible bounds' }
  return [pscustomobject]@{ hwnd = [string]$h; pid = $targetPid; title = [string]$el.Current.Name; rect = [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } }
}

function Get-InputDiagnostics {
  $el = Get-InputFocus
  $out = [ordered]@{ type = ''; writable = $false; name = ''; window = ''; native = ''; focusHwnd = ''; hwnd = ''; pid = 0; rect = $null; caret = $null; readOnly = $null }
  if ($null -ne $el) {
    try {
      $out.type = Get-CT $el
      $out.writable = Test-TextLike $el
      $out.name = [string]$el.Current.Name
      $top = Get-TopLevel $el
      $out.window = [string]$top.Current.Name
      $vp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $out.readOnly = [bool]$vp.Current.IsReadOnly }
    } catch {}
  }
  try {
    $fg = [XpWin]::GetForegroundWindow()
    $out.hwnd = [string]$fg
    $out.pid = [XpWin]::ProcessOf($fg)
    $info = [XpWin]::FocusData()
    $fh = $info.hwndFocus
    $out.focusHwnd = [string]$fh
    $out.native = [XpWin]::ClassOf($fh)
    $fr = [XpWin]::BoundsOf($fh)
    if ($fr -ne $null) { $out.rect = [pscustomobject]@{ x = $fr.left; y = $fr.top; w = ($fr.right - $fr.left); h = ($fr.bottom - $fr.top) } }
    if ($info.hwndCaret -ne [IntPtr]::Zero) {
      $cr = [XpWin]::CaretBounds($info)
      if ($cr -ne $null) { $out.caret = [pscustomobject]@{ hwnd = [string]$info.hwndCaret; x = $cr.left; y = $cr.top; w = ($cr.right - $cr.left); h = ($cr.bottom - $cr.top) } }
    }
  } catch {}
  return [pscustomobject]$out
}

function Test-RectPoint($rect, [double]$x, [double]$y) {
  return ($null -ne $rect -and $rect.w -gt 0 -and $rect.h -gt 0 -and $x -ge $rect.x -and $x -lt ($rect.x + $rect.w) -and $y -ge $rect.y -and $y -lt ($rect.y + $rect.h))
}

# Custom fields require a fresh visual focus request AND independent native
# evidence. A Pane, a window title or TextPattern alone never authorizes input.
# Geometry checks are separate so Tk container/caret cases can be tested without
# injecting keyboard input. An empty reason means the geometry is acceptable.
function Get-VisualInputGeometryRejection($d, $guard) {
  if ($d.readOnly -eq $true) { return 'READ_ONLY' }
  if (-not $d.focusHwnd -or -not $d.caret -or $d.caret.h -le 0) { return 'NO_NATIVE_CARET' }
  if (@('Button','CheckBox','RadioButton','MenuItem','Hyperlink','Text') -contains $d.type) { return 'NON_INPUT_CONTROL' }
  if (-not (Test-RectPoint $d.rect $guard.at.x $guard.at.y)) { return 'CLICK_OUTSIDE_FOCUS' }
  if (-not (Test-RectPoint $d.rect ($d.caret.x + $d.caret.w / 2) ($d.caret.y + $d.caret.h / 2))) { return 'CARET_OUTSIDE_FOCUS' }
  if ($d.rect.w -gt $guard.window.rect.w) { return 'FOCUS_TOO_WIDE' }
  if ($d.native -eq 'TkChild') {
    # Tk can report the whole container as Pane. Do not whitelist the class:
    # require its own native caret on the clicked text line, plus all window
    # identity checks in Test-VisualInput. A distant caret cannot authorize input.
    if ([string]$d.caret.hwnd -ne [string]$d.focusHwnd) { return 'TK_CARET_NOT_FOCUSED_CHILD' }
    if ($d.caret.h -gt 80 -or $d.caret.w -gt 8 -or $d.caret.w -lt 0) { return 'TK_INVALID_CARET' }
    $pad = [Math]::Max(4, [Math]::Min(12, $d.caret.h / 2))
    if ($guard.at.y -lt ($d.caret.y - $pad) -or $guard.at.y -gt ($d.caret.y + $d.caret.h + $pad)) { return 'TK_CLICK_NOT_ON_CARET_LINE' }
  } elseif ($d.rect.h -gt 180) { return 'FOCUS_TOO_TALL' }
  return ''
}

function Test-VisualInput($guard) {
  $script:VisualInputRejection = ''
  if (-not $guard -or -not $guard.visual -or -not $guard.at) { $script:VisualInputRejection = 'VISUAL_FOCUS_REQUIRED'; return $false }
  try {
    [void](Get-BoundWindow $guard.window $false)
    $d = Get-InputDiagnostics
    $reason = Get-VisualInputGeometryRejection $d $guard
    if ($reason) { $script:VisualInputRejection = $reason; return $false }
    $fh = [IntPtr]([long]$d.focusHwnd)
    $ch = [IntPtr]([long]$d.caret.hwnd)
    $wh = [IntPtr]([long]$guard.window.hwnd)
    if ([XpWin]::RootOf($fh) -ne $wh -or [XpWin]::RootOf($ch) -ne $wh) { $script:VisualInputRejection = 'WRONG_WINDOW'; return $false }
    if (-not [XpWin]::IsWindowEnabled($fh)) { $script:VisualInputRejection = 'FOCUS_DISABLED'; return $false }
    return $true
  } catch { $script:VisualInputRejection = 'WINDOW_CHECK_FAILED: ' + $_.Exception.Message; return $false }
}

function Assert-TypeFocus($field, $guard, [string]$nativeFocus) {
  if ($guard) { [void](Get-BoundWindow $guard.window $false) }
  if ($nativeFocus) {
    if ([string][XpWin]::FocusHandle() -ne $nativeFocus) { throw 'INPUT_FOCUS_CHANGED: Keyboard focus changed; input stopped' }
    if ($guard -and [XpWin]::RootOf([IntPtr]([long]$nativeFocus)) -ne [IntPtr]([long]$guard.window.hwnd)) { throw 'INPUT_FOCUS_CHANGED: Keyboard focus belongs to another window' }
  }
  if ($null -ne $field -and (Test-TextLike $field) -and -not (Test-InputFocus (Get-InputFocus) $field)) {
    throw 'INPUT_FOCUS_CHANGED: Selected field lost focus; input stopped'
  }
}

function Assert-LastTypeFocus($target, [string]$nativeFocus) {
  [void](Get-BoundWindow $target $false)
  if (-not $nativeFocus) { throw 'INPUT_FOCUS_CHANGED: Missing post-write focus identity' }
  if (-not $script:LastTypeFocus -or $script:LastTypeFocus.window -ne $target.hwnd) { throw 'INPUT_FOCUS_CHANGED: No matching completed write' }
  Assert-TypeFocus $script:LastTypeFocus.field @{ window = $target } $nativeFocus
}

# Copy only from an already-authorized custom field. Snapshot all available
# clipboard formats before placing a unique sentinel; failed copies cannot
# accidentally verify stale clipboard content. Clipboard errors are fatal.
function Get-ClipboardSnapshot {
  $backup = New-Object System.Windows.Forms.DataObject
  $old = [System.Windows.Forms.Clipboard]::GetDataObject()
  if ($null -ne $old) {
    foreach ($format in $old.GetFormats($false)) { $backup.SetData($format, $false, $old.GetData($format, $false)) }
  }
  return $backup
}

function Read-VisualInput($field, $guard, [string]$nativeFocus) {
  Assert-TypeFocus $field $guard $nativeFocus
  $backup = Get-ClipboardSnapshot
  $marker = 'NUBBO_COPY_' + [Guid]::NewGuid().ToString('N')
  $value = $null
  try {
    [System.Windows.Forms.Clipboard]::SetText($marker)
    Assert-TypeFocus $field $guard $nativeFocus
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    Assert-TypeFocus $field $guard $nativeFocus
    [System.Windows.Forms.SendKeys]::SendWait('^c')
    for ($i = 0; $i -lt 5; $i++) {
      Start-Sleep -Milliseconds 80
      Assert-TypeFocus $field $guard $nativeFocus
      if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $text = [System.Windows.Forms.Clipboard]::GetText()
        if ($text -ne $marker) { $value = $text; break }
      }
    }
  } finally {
    [System.Windows.Forms.Clipboard]::SetDataObject($backup, $true)
  }
  if ($null -eq $value) { throw 'INPUT_READBACK_UNAVAILABLE: Custom field text could not be verified; no Enter sent' }
  return $value
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
    'inputTarget' { return (Get-InputTarget $P) }
    'assertInputTarget' {
      if ($P.focusHwnd) { Assert-LastTypeFocus $P.target ([string]$P.focusHwnd) }
      else { [void](Get-BoundWindow $P.target $false) }
      return $true
    }
    'cursorPos' {
      # GERÇEK imleç konumu: "oradan tıkla" bellekteki tahmine değil buna bakar.
      $p = Get-CursorPoint
      return [pscustomobject]@{ x = [int]$p.X; y = [int]$p.Y }
    }
    'clickCurrentAt' {
      # Fare konumundan tıklama. $P.hwnd, TAŞIMA anındaki penceredir; arada pencere
      # değiştiyse ya da nokta başka pencereyle örtüldüyse TIKLAMAYIZ.
      $x = [int]$P.x; $y = [int]$P.y
      $kok = [XpWin]::RootAt($x, $y)
      if ($P.hwnd -and [IntPtr]([long]$P.hwnd) -ne [IntPtr]::Zero -and $kok -ne [IntPtr]([long]$P.hwnd)) {
        throw 'INPUT_CLICK_STALE: Fare noktası artık aynı pencerede değil; tıklama gönderilmedi'
      }
      if ($P.target) {
        [void](Get-BoundWindow $P.target $false)
        if ($kok -ne [IntPtr]([long]$P.target.hwnd)) { throw 'INPUT_CLICK_OCCLUDED: Target point is covered by another window' }
      }
      Invoke-MouseAt $x $y 'left'
      return $true
    }
    'moveAt' {
      # YALNIZ imleci taşır: tıklama göndermez. Örtülme kontrolü clickAt ile aynıdır ki
      # görünmeyen bir noktaya "gidildi" denmesin.
      if ($P.target) {
        [void](Get-BoundWindow $P.target $false)
        if ([XpWin]::RootAt([int]$P.x, [int]$P.y) -ne [IntPtr]([long]$P.target.hwnd)) { throw 'INPUT_MOVE_OCCLUDED: Target point is covered by another window' }
      }
      [void][XpWin]::SetCursorPos([int]$P.x, [int]$P.y)
      return [pscustomobject]@{ hwnd = [long]([XpWin]::RootAt([int]$P.x, [int]$P.y)) }
    }
    'clickAt' {
      if ($P.target) {
        [void](Get-BoundWindow $P.target $false)
        if ([XpWin]::RootAt([int]$P.x, [int]$P.y) -ne [IntPtr]([long]$P.target.hwnd)) { throw 'INPUT_CLICK_OCCLUDED: Target point is covered by another window' }
      }
      Invoke-MouseAt ([int]$P.x) ([int]$P.y) ([string]$P.button)
      return $true
    }
    'locate' {
      $win = Find-WindowOrNull ([string]$P.windowTitle)
      if ($null -eq $win) { return $null }
      if ($P.readOnly -ne $true) { Enter-Window $win }
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
      $right = [Math]::Min($v.x + $v.w, [int]$P.x + [int]$P.w)
      $bottom = [Math]::Min($v.y + $v.h, [int]$P.y + [int]$P.h)
      if ($right -le $x -or $bottom -le $y) { throw 'INPUT_CAPTURE_OUTSIDE: Requested region is outside the desktop' }
      $w = $right - $x
      $h = $bottom - $y
      $rect = [pscustomobject]@{ x = $x; y = $y; w = $w; h = $h }
      $bmp = Get-ScreenBitmap $rect
      $maxW = 800
      if ($P.maxW) { $maxW = [int]$P.maxW }
      try { $img = ConvertTo-JpegBase64 $bmp (New-Object System.Collections.ArrayList) $rect $false $maxW ([int]$P.snap) ($P.fit -eq $true) }
      finally { $bmp.Dispose() }
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
      $out = [ordered]@{ cleared = $false; skippedClear = $false; pasted = $false; focusType = ''; focusHwnd = ''; writeSent = $false; code = ''; diagnostics = $null; rescued = $false; where = ''; via = ''; needChoice = $false; choices = @(); value = $null }
      $script:LastTypeFocus = $null
      if ($P.guard) { [void](Get-BoundWindow $P.guard.window $false) }
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
        } elseif ($choices.Count -eq 1 -and -not $P.guard) {
          $picked = $choices[0]
        } elseif ($choices.Count -gt 0) {
          $out.needChoice = $true
          $out.choices = $public
          return [pscustomobject]$out
        }
      }
      if ($null -ne $picked) {
        $out.where = [string]$picked.window
        $result = if ($P.clearFirst) { Set-TextValue $picked.el ([string]$P.text) $P.guard } else { $false }
        if ($result) {
          $out.writeSent = $true
          $out.rescued = $true
          $out.where = [string]$picked.window
          $out.via = 'value'
          $out.focusType = [string]$picked.type
          $out.cleared = $true
          $out.value = $result.value
          if ($P.guard) {
            $out.focusHwnd = [string][XpWin]::FocusHandle()
            Assert-TypeFocus $picked.el $P.guard $out.focusHwnd
            $script:LastTypeFocus = @{ window = $P.guard.window.hwnd; field = $picked.el }
          }
          if ($P.pressEnter) {
            Start-Sleep -Milliseconds 200
            if ($P.guard) { Assert-LastTypeFocus $P.guard.window $out.focusHwnd }
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          }
          return [pscustomobject]$out
        }
        # A writable field without ValuePattern still supports normal typing.
        if (-not (Focus-Input $picked.el $P.guard)) { throw 'Seçilen yazı alanı odaklanamadı; yazı gönderilmedi.' }
        $focus = Get-InputFocus
        if (-not (Test-InputFocus $focus $picked.el)) { throw 'Seçilen yazı alanı odağı alamadı; yazı gönderilmedi.' }
        $out.focusType = Get-CT $focus
      }
      try { $out.where = [string](Get-TopLevel $focus).Current.Name } catch {}
      $visual = (-not (Test-TextLike $focus)) -and (Test-VisualInput $P.guard)
      if (-not (Test-TextLike $focus) -and -not $visual) {
        $out.skippedClear = $true
        $out.code = 'INPUT_FOCUS_UNRESOLVED'
        $out.diagnostics = Get-InputDiagnostics
        $out.diagnostics | Add-Member -NotePropertyName inputRejection -NotePropertyValue $script:VisualInputRejection
        return [pscustomobject]$out
      }
      if ($P.guard -and $P.guard.at -and -not $visual -and $null -eq $picked -and -not (Test-PointInside $focus $atX $atY)) {
        $out.skippedClear = $true
        $out.code = 'INPUT_TARGET_UNRESOLVED'
        $out.diagnostics = Get-InputDiagnostics
        return [pscustomobject]$out
      }
      $nativeFocus = ''
      if ($P.guard) { try { $nativeFocus = [string][XpWin]::FocusHandle() } catch {} }
      if ($P.guard -and (-not $nativeFocus -or $nativeFocus -eq '0')) { throw 'INPUT_FOCUS_CHANGED: No native keyboard focus identity' }
      $out.focusHwnd = $nativeFocus
      if ($visual) {
        # Copying selects text; an unknown custom field cannot safely preserve
        # an append caret. Only explicit replacement is supported here.
        if (-not $P.clearFirst) { throw 'INPUT_CUSTOM_APPEND_UNSUPPORTED: Use explicit replacement for a custom field' }
        # Check clipboard access before input. Do not require copying the old
        # text: an empty editable field legitimately has nothing to copy.
        [void](Get-ClipboardSnapshot)
        $out.via = 'visual-caret'
      }
      $check = { Assert-TypeFocus $focus $P.guard $nativeFocus }
      if ($P.guard) { & $check }
      if ($P.clearFirst) {
        # Ctrl+A / Delete only inside a text field; elsewhere it would select and delete the app's content.
        if ((Test-TextLike $focus) -or $visual) {
          Start-Sleep -Milliseconds 120
          if ($P.guard) { & $check }
          [System.Windows.Forms.SendKeys]::SendWait('^a')
          Start-Sleep -Milliseconds 280
          if ($P.guard) { & $check }
          $out.writeSent = $true
          [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
          Start-Sleep -Milliseconds 200
          # Some classic edit boxes ignore Ctrl+A. If the box still holds text, select it with EM_SETSEL and delete again.
          # Only a box whose text can be read is touched, so where Ctrl+A works nothing changes.
          $left = Get-NativeEditText $focus
          if ($null -ne $left -and $left.Length -gt 0) {
            $hwnd = [IntPtr]0
            try { $hwnd = [IntPtr]$focus.Current.NativeWindowHandle } catch {}
            if ($P.guard) { & $check }
            if ([XpWin]::SelectAll($hwnd)) {
              Start-Sleep -Milliseconds 120
              if ($P.guard) { & $check }
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
        if ($P.guard) { & $check }
        $out.writeSent = $true
        if ([XpText]::CanType($text)) {
          if ($P.guard) { Send-TextPaced $text 20 $check } else { Send-TextPaced $text 20 }
        } else {
          $old = if ($visual) { Get-ClipboardSnapshot } else { [XpText]::SetClipboard($text) }
          try {
            if ($visual) { [System.Windows.Forms.Clipboard]::SetText($text) }
            Start-Sleep -Milliseconds 80
            # Paste sends whatever is on the clipboard, so make sure it is our text.
            # Pasting the previous content would type the wrong thing into the field.
            if (-not [XpText]::ClipboardHas($text)) {
              throw 'CLIPBOARD_SET_FAILED: Pano ayarlanamadi; yanlis metin yapistirilmamasi icin yapistirma yapilmadi.'
            }
            if ($P.guard) { & $check }
            [System.Windows.Forms.SendKeys]::SendWait('^v')
            Start-Sleep -Milliseconds 250
          } finally {
            if ($visual) { [System.Windows.Forms.Clipboard]::SetDataObject($old, $true) }
            else { [XpText]::RestoreClipboard($old) }
          }
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
      if ($visual) { $out.value = Read-VisualInput $focus $P.guard $nativeFocus }
      if ($P.guard) {
        & $check
        $script:LastTypeFocus = @{ window = $P.guard.window.hwnd; field = $focus }
      }
      if ($P.pressEnter) {
        Start-Sleep -Milliseconds 240
        if ($P.guard) { & $check }
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
      if ($P.target) {
        if ($P.focusHwnd) { Assert-LastTypeFocus $P.target ([string]$P.focusHwnd) }
        else { [void](Get-BoundWindow $P.target $false) }
      }
      if ($P.windowTitle) {
        $win = Find-Window ([string]$P.windowTitle)
        Enter-Window $win
        # The window is in front now unless something else took the foreground. Windows
        # shortcuts are exempt: they are meant to leave the target application.
        if (-not (Test-SystemShortcut ([string]$P.keys))) { Assert-KeyWindowActive $win }
      } elseif ($null -ne $script:LastKeyWindow) {
        # No window was named, so compare against the window the run last worked on. Until a
        # window is known at all, the key goes as it always did: a lap must not stop over this.
        if (-not (Test-SystemShortcut ([string]$P.keys))) {
          try { Assert-KeyWindowActive $script:LastKeyWindow }
          catch {
            if ($_.Exception.Message -like '*INPUT_WINDOW_NOT_ACTIVE*') { throw }
            # The remembered window can no longer be read; nothing is compared, the key goes.
          }
        }
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
      return [pscustomobject]@{ title = [string]$el.Current.Name; pid = [int]$el.Current.ProcessId; proc = $procName; hwnd = [string]$h }
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
    'inputState' { return (Get-InputDiagnostics) }
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
