$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing

if (-not ('XpNative' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class XpNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  public static bool IsCloaked(IntPtr hWnd) {
    int v = 0;
    try { if (DwmGetWindowAttribute(hWnd, 14, out v, 4) == 0) return v != 0; } catch { }
    return false;
  }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
}
[void][XpNative]::SetProcessDPIAware()

if (-not ('XpInput' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
public static class XpInput {
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern short VkKeyScanW(char ch);

  public static void Wheel(int x, int y, int clicks, bool horizontal) {
    SetCursorPos(x, y);
    Thread.Sleep(40);
    int step = clicks >= 0 ? 120 : -120;
    for (int i = 0; i < Math.Abs(clicks); i++) {
      mouse_event(horizontal ? 0x01000u : 0x0800u, 0, 0, unchecked((uint)step), UIntPtr.Zero);
      Thread.Sleep(30);
    }
  }

  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1);
    Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(120);
    int steps = 18;
    for (int i = 1; i <= steps; i++) {
      SetCursorPos(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      Thread.Sleep(15);
    }
    Thread.Sleep(80);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }

  static readonly Dictionary<string, int> Named = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) {
    {"ctrl",0x11},{"control",0x11},{"shift",0x10},{"alt",0x12},{"win",0x5B},{"lwin",0x5B},{"rwin",0x5C},{"meta",0x5B},{"cmd",0x5B},{"super",0x5B},
    {"enter",0x0D},{"return",0x0D},{"esc",0x1B},{"escape",0x1B},{"tab",0x09},{"space",0x20},{"backspace",0x08},
    {"delete",0x2E},{"del",0x2E},{"insert",0x2D},{"home",0x24},{"end",0x23},{"pageup",0x21},{"pagedown",0x22},
    {"left",0x25},{"up",0x26},{"right",0x27},{"down",0x28},{"arrowleft",0x25},{"arrowup",0x26},{"arrowright",0x27},{"arrowdown",0x28},
    {"minus",0xBD},{"-",0xBD},{"plus",0xBB},{"=",0xBB},{"comma",0xBC},{",",0xBC},{"period",0xBE},{".",0xBE},{"slash",0xBF},{"/",0xBF},
    {"capslock",0x14},{"printscreen",0x2C},{"numpad0",0x60},{"numpad1",0x61},{"numpad2",0x62},{"numpad3",0x63},{"numpad4",0x64},
    {"numpad5",0x65},{"numpad6",0x66},{"numpad7",0x67},{"numpad8",0x68},{"numpad9",0x69}
  };
  static readonly HashSet<int> Extended = new HashSet<int> { 0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2D,0x2E,0x5B,0x5C };

  static int Vk(string name) {
    int v;
    if (Named.TryGetValue(name, out v)) return v;
    if (name.Length == 1) {
      char c = char.ToUpperInvariant(name[0]);
      if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
    }
    if (name.Length >= 2 && (name[0] == 'f' || name[0] == 'F')) {
      int n;
      if (int.TryParse(name.Substring(1), out n) && n >= 1 && n <= 24) return 0x70 + n - 1;
    }
    return -1;
  }

  // Do not sleep during cleanup: a second interrupted sleep must not skip the remaining keys.
  // Attempt every release even if one native call throws, then report that error.
  static void ReleaseKeys(List<int> down) {
    Exception first = null;
    for (int i = down.Count - 1; i >= 0; i--) {
      int key = down[i];
      try { keybd_event((byte)key, 0, (Extended.Contains(key) ? 1u : 0u) | 2u, UIntPtr.Zero); }
      catch (Exception e) { if (first == null) first = e; }
    }
    if (first != null) throw new InvalidOperationException("KEY_RELEASE_FAILED", first);
  }

  /// Validate the whole shortcut first. Every pressed key is released, including on an exception.
  public static string Combo(string[] names) {
    if (names == null || names.Length == 0) return "EMPTY";
    var codes = new List<int>();
    foreach (var raw in names) {
      if (raw == null) return "UNKNOWN_KEY: null";
      var n = raw.Trim();
      if (n.Length == 0) continue;
      int v = Vk(n);
      if (v < 0) return "UNKNOWN_KEY: " + n;
      if (!codes.Contains(v)) codes.Add(v);
    }
    if (codes.Count == 0) return "EMPTY";
    var down = new List<int>();
    try {
      foreach (var c in codes) {
        down.Add(c);
        keybd_event((byte)c, 0, Extended.Contains(c) ? 1u : 0u, UIntPtr.Zero);
        Thread.Sleep(25);
      }
    } finally { ReleaseKeys(down); }
    return "";
  }

  /// One shortcut. Modifiers go down, vk is tapped the given number of times, then modifiers come back up.
  /// vk 0 presses only the modifiers. They are released even when a tap throws.
  public static void Chord(int[] mods, int vk, int times) {
    var down = new List<int>();
    try {
      if (mods != null) {
        foreach (var m in mods) {
          if (m == 0 || down.Contains(m)) continue;
          down.Add(m);
          keybd_event((byte)m, 0, Extended.Contains(m) ? 1u : 0u, UIntPtr.Zero);
          Thread.Sleep(25);
        }
      }
      if (vk != 0) {
        if (times < 1) times = 1;
        uint ext = Extended.Contains(vk) ? 1u : 0u;
        for (int n = 0; n < times; n++) {
          try {
            keybd_event((byte)vk, 0, ext, UIntPtr.Zero);
            Thread.Sleep(20);
          } finally {
            keybd_event((byte)vk, 0, ext | 2u, UIntPtr.Zero);
          }
          if (n + 1 < times) Thread.Sleep(20);
        }
      }
    } finally {
      ReleaseKeys(down);
    }
  }

  /// Low byte is the virtual key, high byte is the shift state (1 shift, 2 ctrl, 4 alt). -1 if this layout cannot type it.
  public static int ScanChar(char ch) {
    short scan = VkKeyScanW(ch);
    if (scan == -1) return -1;
    return scan & 0xFFFF;
  }
}
"@
}

if (-not ('XpText' -as [type])) {
  Add-Type -ReferencedAssemblies System.Windows.Forms, UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
public static class XpText {
  [DllImport("user32.dll")] static extern short VkKeyScan(char ch);

  /// Every character can be produced by the current keyboard layout (so SendKeys can type it).
  public static bool CanType(string s) {
    foreach (char c in s) {
      if (c == '\n' || c == '\r' || c == '\t') continue;
      if (VkKeyScan(c) == -1) return false;
    }
    return true;
  }

  /// Puts text on the clipboard from an STA thread; returns the previous text (or null).
  public static string SetClipboard(string text) {
    string old = null;
    var t = new Thread(() => {
      try { if (System.Windows.Forms.Clipboard.ContainsText()) old = System.Windows.Forms.Clipboard.GetText(); } catch { }
      for (int i = 0; i < 5; i++) {
        try { System.Windows.Forms.Clipboard.SetText(text); break; } catch { Thread.Sleep(60); }
      }
    });
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    t.Join(3000);
    return old;
  }

  public static void RestoreClipboard(string text) {
    if (text == null) return;
    var t = new Thread(() => { try { System.Windows.Forms.Clipboard.SetText(text); } catch { } });
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    t.Join(2000);
  }

  /// FindAll with a time limit. Huge trees (browsers) are dropped instead of stalling the whole scan.
  public static AutomationElementCollection FindAllBounded(AutomationElement root, Condition cond, CacheRequest cr, int timeoutMs) {
    AutomationElementCollection result = null;
    var t = new Thread(() => {
      try {
        using (cr.Activate()) { result = root.FindAll(TreeScope.Descendants, cond); }
      } catch { }
    });
    t.IsBackground = true;
    t.Start();
    if (!t.Join(timeoutMs)) return null;
    return result;
  }
}
"@
}

if (-not ('XpImage' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class XpImage {
  static float[] Gray(Bitmap b) {
    var r = new Rectangle(0, 0, b.Width, b.Height);
    var d = b.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var bytes = new byte[d.Stride * b.Height];
    Marshal.Copy(d.Scan0, bytes, 0, bytes.Length);
    b.UnlockBits(d);
    var g = new float[b.Width * b.Height];
    for (int y = 0; y < b.Height; y++) {
      int row = y * d.Stride;
      for (int x = 0; x < b.Width; x++) {
        int i = row + x * 3;
        g[y * b.Width + x] = 0.114f * bytes[i] + 0.587f * bytes[i + 1] + 0.299f * bytes[i + 2];
      }
    }
    return g;
  }

  static float[] Shrink(float[] s, int w, int h, int f, out int nw, out int nh) {
    nw = Math.Max(1, w / f); nh = Math.Max(1, h / f);
    var o = new float[nw * nh];
    for (int y = 0; y < nh; y++)
      for (int x = 0; x < nw; x++) {
        float sum = 0;
        for (int j = 0; j < f; j++) for (int i = 0; i < f; i++) sum += s[(y * f + j) * w + (x * f + i)];
        o[y * nw + x] = sum / (f * f);
      }
    return o;
  }

  static double Ncc(float[] S, int sw, float[] T, int tw, int th, double tMean, double tNorm, int ox, int oy) {
    double sum = 0, sum2 = 0, cross = 0;
    int n = tw * th;
    for (int y = 0; y < th; y++) {
      int srow = (oy + y) * sw + ox;
      int trow = y * tw;
      for (int x = 0; x < tw; x++) {
        double v = S[srow + x];
        sum += v; sum2 += v * v; cross += v * T[trow + x];
      }
    }
    double mean = sum / n;
    double varS = sum2 - n * mean * mean;
    if (varS < 1e-3) return 0;
    return (cross - n * mean * tMean) / (Math.Sqrt(varS) * tNorm);
  }

  static void Stats(float[] T, out double mean, out double norm) {
    double s = 0, s2 = 0;
    foreach (var v in T) { s += v; s2 += v * v; }
    mean = s / T.Length;
    norm = Math.Sqrt(Math.Max(0, s2 - T.Length * mean * mean));
  }

  /// Best normalized cross-correlation of the template inside the screen. Returns {cx, cy, score}.
  public static double[] Find(Bitmap screen, Bitmap tpl) {
    int sw = screen.Width, sh = screen.Height, tw = tpl.Width, th = tpl.Height;
    if (tw >= sw || th >= sh || tw < 4 || th < 4) return new double[] { 0, 0, 0 };
    var S = Gray(screen);
    var T = Gray(tpl);
    double tm, tn;
    Stats(T, out tm, out tn);
    if (tn < 1) return new double[] { 0, 0, 0 };

    int f = Math.Max(1, Math.Min(tw, th) / 12);
    f = Math.Max(f, (int)Math.Ceiling(sw / 800.0));
    f = Math.Min(f, Math.Max(1, Math.Min(tw, th) / 4));
    int cw, ch, ctw, cth;
    var S1 = Shrink(S, sw, sh, f, out cw, out ch);
    var T1 = Shrink(T, tw, th, f, out ctw, out cth);
    double tm1, tn1;
    Stats(T1, out tm1, out tn1);
    if (tn1 < 1) { S1 = S; T1 = T; cw = sw; ch = sh; ctw = tw; cth = th; tm1 = tm; tn1 = tn; f = 1; }

    var cands = new List<double[]>();
    for (int y = 0; y + cth <= ch; y++)
      for (int x = 0; x + ctw <= cw; x++) {
        double sc = Ncc(S1, cw, T1, ctw, cth, tm1, tn1, x, y);
        if (sc < 0.5) continue;
        cands.Add(new double[] { x, y, sc });
      }
    cands.Sort((a, b) => b[2].CompareTo(a[2]));
    var picked = new List<double[]>();
    foreach (var c in cands) {
      bool near = false;
      foreach (var p in picked) if (Math.Abs(p[0] - c[0]) < ctw && Math.Abs(p[1] - c[1]) < cth) { near = true; break; }
      if (near) continue;
      picked.Add(c);
      if (picked.Count >= 6) break;
    }

    double bx = 0, by = 0, best = 0;
    foreach (var c in picked) {
      int x0 = (int)c[0] * f, y0 = (int)c[1] * f, r = f * 2;
      for (int y = Math.Max(0, y0 - r); y <= Math.Min(sh - th, y0 + r); y++)
        for (int x = Math.Max(0, x0 - r); x <= Math.Min(sw - tw, x0 + r); x++) {
          double sc = Ncc(S, sw, T, tw, th, tm, tn, x, y);
          if (sc > best) { best = sc; bx = x; by = y; }
        }
    }
    return new double[] { bx + tw / 2.0, by + th / 2.0, best };
  }

  /// 32x18 grayscale thumbnail, used to tell whether the screen changed.
  public static byte[] Signature(Bitmap b) {
    var g = Gray(b);
    int w = b.Width, h = b.Height;
    var o = new byte[32 * 18];
    for (int y = 0; y < 18; y++)
      for (int x = 0; x < 32; x++) {
        int x0 = x * w / 32, x1 = Math.Max(x0 + 1, (x + 1) * w / 32);
        int y0 = y * h / 18, y1 = Math.Max(y0 + 1, (y + 1) * h / 18);
        double s = 0; int n = 0;
        for (int yy = y0; yy < y1; yy += 2) for (int xx = x0; xx < x1; xx += 2) { s += g[yy * w + xx]; n++; }
        o[y * 32 + x] = (byte)Math.Max(0, Math.Min(255, s / Math.Max(1, n)));
      }
    return o;
  }
}
"@
}

$script:AE = [System.Windows.Automation.AutomationElement]
$script:Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Test-Same($a, $b) {
  if ($null -eq $a -or $null -eq $b) { return $false }
  return [System.Windows.Automation.Automation]::Compare($a, $b)
}

function Get-CT($el) {
  try { return ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '') }
  catch { return 'Unknown' }
}

function Get-TopWindows([int]$ownPid = 0) {
  $list = New-Object System.Collections.ArrayList
  $c = $script:Walker.GetFirstChild($script:AE::RootElement)
  while ($null -ne $c) {
    try {
      $name = $c.Current.Name
      if ($name -and ($ownPid -eq 0 -or $c.Current.ProcessId -ne $ownPid)) {
        [void]$list.Add($c)
      }
    } catch {}
    $c = $script:Walker.GetNextSibling($c)
  }
  # Callers consume individual windows, including through Where-Object. A unary
  # comma would send one ArrayList and make multi-window native-handle checks fail.
  return $list
}

function Test-UsableWindow($w) {
  try {
    $h = [IntPtr]$w.Current.NativeWindowHandle
    if ($h -eq [IntPtr]::Zero) { return $true }
    return ([XpNative]::IsWindowVisible($h) -and -not [XpNative]::IsCloaked($h))
  } catch { return $false }
}

# Window titles change with the open tab/folder ("X - Opera", "Y - Dosya Gezgini"),
# so after exact and substring matches we fall back to the app suffix after the last " - ".
function Find-WindowOrNull([string]$title) {
  if ([string]::IsNullOrWhiteSpace($title)) { return $null }
  $wins = @(Get-TopWindows | Where-Object { Test-UsableWindow $_ })
  $t = $title.Trim()
  foreach ($w in $wins) { if ($w.Current.Name -eq $t) { return $w } }
  foreach ($w in $wins) { if ($w.Current.Name.IndexOf($t, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $w } }
  $idx = $t.LastIndexOf(' - ')
  if ($idx -ge 0) {
    $suffix = $t.Substring($idx)
    if ($suffix.Length -gt 4) {
      foreach ($w in $wins) { if ($w.Current.Name.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) { return $w } }
    }
  }
  return $null
}

function Find-Window([string]$title) {
  if ([string]::IsNullOrWhiteSpace($title)) { throw 'NO_TARGET_WINDOW' }
  $w = Find-WindowOrNull $title
  if ($null -eq $w) { throw "WINDOW_NOT_FOUND: $title" }
  return $w
}

function Enter-Window($win) {
  try {
    $h = [IntPtr]$win.Current.NativeWindowHandle
    if ($h -ne [IntPtr]::Zero) {
      if ([XpNative]::IsIconic($h)) { [void][XpNative]::ShowWindow($h, 9) }
      [void][XpNative]::SetForegroundWindow($h)
      Start-Sleep -Milliseconds 150
    }
  } catch {}
}

function Get-TopLevel($el) {
  $root = $script:AE::RootElement
  $cur = $el
  while ($true) {
    $p = $script:Walker.GetParent($cur)
    if ($null -eq $p -or (Test-Same $p $root)) { return $cur }
    $cur = $p
  }
}

function Get-SiblingIndex($el) {
  $p = $script:Walker.GetParent($el)
  if ($null -eq $p) { return 0 }
  $i = 0
  $c = $script:Walker.GetFirstChild($p)
  while ($null -ne $c) {
    if (Test-Same $c $el) { return $i }
    $i++
    $c = $script:Walker.GetNextSibling($c)
  }
  return -1
}

function Get-RelPath($el, $top) {
  $segs = New-Object System.Collections.ArrayList
  $cur = $el
  $guard = 0
  while (-not (Test-Same $cur $top) -and $guard -lt 64) {
    [void]$segs.Insert(0, [string](Get-SiblingIndex $cur))
    $cur = $script:Walker.GetParent($cur)
    if ($null -eq $cur) { break }
    $guard++
  }
  if ($segs.Count -eq 0) { return '0' }
  return '0/' + ($segs -join '/')
}

function Resolve-RelPath($top, [string]$path) {
  $parts = $path.Split('/')
  $el = $top
  for ($i = 1; $i -lt $parts.Length; $i++) {
    $idx = [int]$parts[$i]
    $c = $script:Walker.GetFirstChild($el)
    $k = 0
    while ($null -ne $c -and $k -lt $idx) {
      $c = $script:Walker.GetNextSibling($c)
      $k++
    }
    if ($null -eq $c) { return $null }
    $el = $c
  }
  return $el
}

function Test-LocatorIdentity($e, $loc) {
  if ($null -eq $e) { return $false }
  if ($loc.name -and $e.Current.Name -ne [string]$loc.name) { return $false }
  if ($loc.automationId -and $e.Current.AutomationId -ne [string]$loc.automationId) { return $false }
  if ($loc.controlType -and (Get-CT $e) -ne [string]$loc.controlType) { return $false }
  return $true
}

function Find-ByLocator($top, $loc) {
  $name = [string]$loc.name
  $aid = [string]$loc.automationId
  $ct = [string]$loc.controlType
  $path = [string]$loc.path

  if ($path) {
    $e = Resolve-RelPath $top $path
    if (Test-LocatorIdentity $e $loc) { return $e }
  }
  if ($aid) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($script:AE::AutomationIdProperty, $aid)
    $all = $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($e in $all) { if (Test-LocatorIdentity $e $loc) { return $e } }
  }
  if ($name) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($script:AE::NameProperty, $name)
    $all = $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($e in $all) { if (Test-LocatorIdentity $e $loc) { return $e } }
  }
  return $null
}

function New-Locator($el, $top, [int]$px, [int]$py) {
  $name = [string]$el.Current.Name
  $text = ($name -replace '\s+', ' ').Trim()
  $ct = Get-CT $el
  if ($text.Length -eq 0 -or $text.Length -gt 60 -or $ct -eq 'Pane' -or $ct -eq 'Document' -or $ct -eq 'Window') {
    $near = ''
    try { $near = Get-TextNear $px $py } catch {}
    if ($near) { $text = $near }
  }
  $tr = $top.Current.BoundingRectangle
  return [pscustomobject]@{
    name         = $name
    text         = $text
    controlType  = $ct
    automationId = [string]$el.Current.AutomationId
    path         = (Get-RelPath $el $top)
    windowTitle  = [string]$top.Current.Name
    processId    = [int]$el.Current.ProcessId
    x            = $px
    y            = $py
    offsetX      = [int]($px - $tr.X)
    offsetY      = [int]($py - $tr.Y)
  }
}

function Get-CursorPoint {
  $p = New-Object XpNative+POINT
  [void][XpNative]::GetCursorPos([ref]$p)
  return $p
}

function Get-CursorElement {
  $p = New-Object XpNative+POINT
  [void][XpNative]::GetCursorPos([ref]$p)
  $pt = New-Object System.Windows.Point($p.X, $p.Y)
  return $script:AE::FromPoint($pt)
}
