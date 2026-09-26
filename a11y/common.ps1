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
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
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
  return , $list
}

function Find-Window([string]$title) {
  if ([string]::IsNullOrWhiteSpace($title)) { throw 'NO_TARGET_WINDOW' }
  $wins = Get-TopWindows
  foreach ($w in $wins) { if ($w.Current.Name -eq $title) { return $w } }
  foreach ($w in $wins) { if ($w.Current.Name -like "*$title*") { return $w } }
  throw "WINDOW_NOT_FOUND: $title"
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

function Find-ByLocator($top, $loc) {
  $name = [string]$loc.name
  $aid = [string]$loc.automationId
  $ct = [string]$loc.controlType
  $path = [string]$loc.path

  if ($path) {
    $e = Resolve-RelPath $top $path
    if ($null -ne $e -and (-not $name -or $e.Current.Name -eq $name)) { return $e }
  }
  if ($aid) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($script:AE::AutomationIdProperty, $aid)
    $all = $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($e in $all) { if (-not $name -or $e.Current.Name -eq $name) { return $e } }
    if ($all.Count -gt 0) { return $all.Item(0) }
  }
  if ($name) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($script:AE::NameProperty, $name)
    $all = $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($e in $all) { if (-not $ct -or (Get-CT $e) -eq $ct) { return $e } }
    if ($all.Count -gt 0) { return $all.Item(0) }
  }
  if ($path) { return (Resolve-RelPath $top $path) }
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
