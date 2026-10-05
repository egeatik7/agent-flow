param(
  [Parameter(Mandatory=$true)][long]$WindowHandle,
  [Parameter(Mandatory=$true)][int]$TargetProcess,
  [Parameter(Mandatory=$true)][string]$Output
)
# Read-only, fixture-only evidence. Do not use expected fixture rectangles to
# resolve Nubbo targets and do not invoke any input/provider action here.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FixtureNativeInfo {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern int GetClassName(IntPtr h, StringBuilder text, int length);
  public static string ClassOf(int handle) {
    var text = new StringBuilder(256);
    GetClassName(new IntPtr(handle), text, text.Capacity);
    return text.ToString();
  }
}
'@
function Finite-Number([double]$value) {
  if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $null }
  return $value
}
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
if ($root.Current.ProcessId -ne $TargetProcess) { throw 'Fixture process identity changed' }
$queue = New-Object 'System.Collections.Generic.Queue[object]'
$queue.Enqueue(@{element=$root;depth=0})
$rows = New-Object System.Collections.ArrayList
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
while ($queue.Count -gt 0 -and $rows.Count -lt 300) {
  $next = $queue.Dequeue(); $el = $next.element
  try {
    $c = $el.Current
    if ($c.ProcessId -ne $TargetProcess) { continue }
    $r = $c.BoundingRectangle
    [void]$rows.Add([pscustomobject]@{
      depth=$next.depth;name=$c.Name;automationId=$c.AutomationId
      type=$c.ControlType.ProgrammaticName;class=$c.ClassName
      nativeClass=[FixtureNativeInfo]::ClassOf($c.NativeWindowHandle)
      handle=$c.NativeWindowHandle;enabled=$c.IsEnabled;offscreen=$c.IsOffscreen
      focusable=$c.IsKeyboardFocusable;focused=$c.HasKeyboardFocus
      framework=$c.FrameworkId;provider=$c.ProviderDescription
      patterns=@($el.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
      rect=@{x=(Finite-Number $r.X);y=(Finite-Number $r.Y);w=(Finite-Number $r.Width);h=(Finite-Number $r.Height)}
    })
    if ($next.depth -ge 12) { continue }
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      $queue.Enqueue(@{element=$child;depth=($next.depth+1)})
      $child = $walker.GetNextSibling($child)
    }
  } catch {
    [void]$rows.Add([pscustomobject]@{depth=$next.depth;error=$_.Exception.Message})
  }
}
@{window=$WindowHandle;process=$TargetProcess;truncated=($queue.Count -gt 0);rows=@($rows.ToArray())} |
  ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding UTF8
