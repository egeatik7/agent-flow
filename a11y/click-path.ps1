param(
  [Parameter(Mandatory = $true)][string]$ElementPath,
  [string]$WindowTitle = ""
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$targetRoot = $root

if (-not [string]::IsNullOrWhiteSpace($WindowTitle)) {
  $wins = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window
    ))
  )
  foreach ($w in $wins) {
    if ($w.Current.Name -eq $WindowTitle -or $w.Current.Name -like "*$WindowTitle*") {
      $targetRoot = $w
      break
    }
  }
}

$parts = $ElementPath.Split('/') | Where-Object { $_ -ne "" }
$el = $targetRoot
# If path starts with 0 and we already scoped to a window, skip first segment when it refers to that window
$start = 0
if ($parts.Count -gt 0 -and $parts[0] -eq "0" -and $targetRoot -ne $root) {
  # keep walking from window; first 0 may mean window itself
  if ($parts.Count -eq 1) {
    $el = $targetRoot
  } else {
    $start = 1
  }
}

for ($i = $start; $i -lt $parts.Count; $i++) {
  $idx = [int]$parts[$i]
  $children = $el.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  if ($idx -ge $children.Count) {
    Write-Error "Path segment $idx out of range at depth $i"
    exit 1
  }
  $el = $children.Item($idx)
}

# Try InvokePattern, then SelectionItem, then LegacyIAccessible DoDefaultAction, then click center
$invoked = $false
try {
  $inv = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  if ($null -ne $inv) { $inv.Invoke(); $invoked = $true }
} catch {}

if (-not $invoked) {
  try {
    $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($null -ne $sel) { $sel.Select(); $invoked = $true }
  } catch {}
}

if (-not $invoked) {
  $rect = $el.Current.BoundingRectangle
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseClicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
  public const int MOUSEEVENTF_LEFTDOWN = 0x02;
  public const int MOUSEEVENTF_LEFTUP = 0x04;
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  }
}
"@
  [MouseClicker]::Click($x, $y)
}

Write-Output '{"ok":true}'
