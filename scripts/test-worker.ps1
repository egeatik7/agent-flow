# Runs the actual worker functions against fake UIA elements. No Windows UI,
# extra module or administrator permission is required.
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot '../a11y/worker.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $worker), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
Add-Type -TypeDefinition @'
using System;
namespace System.Windows.Automation { public class ValuePattern { public static object Pattern = new object(); } }
namespace System.Windows { public struct Point { public double X,Y; public Point(double x,double y){X=x;Y=y;} } }
public class MockAE {
 public static object FocusedElement, Front, Point, Native;
 public static object FromHandle(IntPtr h){return h.ToInt64()==7 ? Native : Front;}
 public static object FromPoint(System.Windows.Point p){return Point;}
}
public class XpWin {
 public static IntPtr NativeFocus = IntPtr.Zero;
 public static IntPtr FocusHandle(){return NativeFocus;}
 public static IntPtr GetForegroundWindow(){return new IntPtr(1);}
 public static string ClassOf(IntPtr h){return h.ToInt64()==7 ? "Edit" : "";}
 public static int GetWindowLong(IntPtr h,int i){return 0;}
}
'@
$script:AE = [MockAE]
$script:Writes = New-Object System.Collections.ArrayList
$script:TypeChoiceCache = @{}
# Load function definitions without starting the worker or loading Windows DLLs.
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $f.Extent.Text
}
function Get-CT($el) { if ($null -eq $el) { return '' }; return $el.Type }
function Test-Same($a,$b) { return ($null -ne $a -and $null -ne $b -and $a.Id -eq $b.Id) }
function Get-TopLevel($el) { while ($null -ne $el -and $null -ne $el.Parent) { $el = $el.Parent }; return $el }
function Test-UsableWindow($el) { return $el.Current.IsEnabled }
function Set-HudHandle($p) {}
function Invoke-MouseAt($x,$y,$button) { throw 'Unexpected mouse fallback in mock' }
function Start-Sleep { param($Milliseconds,$Seconds) }
$script:Walker = [pscustomobject]@{}
$script:Walker | Add-Member ScriptMethod GetParent { param($el) return $el.Parent }
$script:Walker | Add-Member ScriptMethod GetFirstChild { param($el) if ($el.Children.Count) { return $el.Children[0] }; return $null }
$script:Walker | Add-Member ScriptMethod GetNextSibling {
  param($el)
  if ($null -eq $el.Parent) { return $null }
  $siblings = @($el.Parent.Children)
  for ($i=0; $i -lt $siblings.Count - 1; $i++) { if ($siblings[$i].Id -eq $el.Id) { return $siblings[$i+1] } }
  return $null
}
function Element($id,$type,$x,$y,$width,$height,$readOnly=$false,$supportsValue=$false) {
  $e = [pscustomobject]@{
    Id=$id; Type=$type; Parent=$null; Children=@(); SupportsValue=$supportsValue
    Current=[pscustomobject]@{
      Name=$id; ProcessId=50; IsEnabled=$true; IsOffscreen=$false; IsKeyboardFocusable=($type -eq 'Edit')
      NativeWindowHandle=0; LabeledBy=$null
      BoundingRectangle=[pscustomobject]@{ X=$x; Y=$y; Width=$width; Height=$height; IsEmpty=$false }
    }
    Pattern=[pscustomobject]@{ Current=[pscustomobject]@{ Value='old'; IsReadOnly=$readOnly }; Owner=$null }
  }
  $e.Pattern.Owner = $e
  $e.Pattern | Add-Member ScriptMethod SetValue {
    param($text)
    $this.Current.Value = $text
    [void]$script:Writes.Add($this.Owner.Id)
  }
  $e | Add-Member ScriptMethod TryGetCurrentPattern {
    param($key,$result)
    if ($this.SupportsValue) { $result.Value=$this.Pattern; return $true }
    return $false
  }
  $e | Add-Member ScriptMethod SetFocus { [MockAE]::FocusedElement = $this }
  return $e
}
function Setup {
  $script:TypeChoiceCache.Clear(); $script:Writes.Clear(); [XpWin]::NativeFocus=[IntPtr]::Zero
  $script:Window=Element 'Run' 'Window' 0 0 600 300
  $script:A=Element 'source' 'Edit' 150 15 300 30 $false $true
  $script:B=Element 'destination' 'Edit' 150 65 300 30 $false $true
  $script:Label=Element 'destination label' 'Text' 20 70 100 20
  $script:ReadOnly=Element 'Explorer metadata' 'Edit' 150 120 300 30 $true $true
  $script:Window.Children=@($script:A,$script:B,$script:Label,$script:ReadOnly)
  foreach ($el in $script:Window.Children) { $el.Parent=$script:Window }
  [MockAE]::Front=$script:Window; [MockAE]::FocusedElement=$script:Window; [MockAE]::Point=$script:Label
}
function Check($condition,$message) { if (-not $condition) { throw $message } }
function Request($extra=@{}) {
  $p=@{ text='new'; clearFirst=$true; pressEnter=$false; x=0; y=0; ownPid=999 }
  foreach ($k in $extra.Keys) { $p[$k]=$extra[$k] }
  return (Invoke-Op 'typeText' ([pscustomobject]$p))
}

Setup
$first=Request
Check $first.needChoice 'Multiple active-window inputs should require a choice'
Check ($first.choices.Count -eq 2) 'Read-only Explorer metadata must not be a writable candidate'
$chosen=@($first.choices | Where-Object { $_.name -eq 'destination' })[0]
# Reorder the tree after the model saw ids. The original object must be written.
$script:Window.Children=@($script:B,$script:A,$script:Label,$script:ReadOnly)
$written=Request @{ fieldToken=$chosen.token }
Check ($script:Writes.Count -eq 1 -and $script:Writes[0] -eq 'destination') 'Selection token must survive reordering'
Check ($written.value -eq 'new') 'Read back the exact field actually written'

Setup
$first=Request; $token=$first.choices[0].token; $script:A.Current.IsEnabled=$false
$failed=$false
try { [void](Request @{ fieldToken=$token }) } catch { $failed=$true }
Check ($failed -and $script:Writes.Count -eq 0) 'Disabled selected fields must not be written'

Setup
$first=Request; $token=$first.choices[0].token
[MockAE]::Front=Element 'Other app' 'Window' 0 0 600 300
$failed=$false
try { [void](Request @{ fieldToken=$token }) } catch { $failed=$true }
Check ($failed -and $script:Writes.Count -eq 0) 'Changing windows during choice must not redirect typing'

Setup
$written=Request @{ x=70; y=80 }
Check (-not $written.needChoice -and $script:Writes[0] -eq 'destination') 'A label must resolve to its adjacent row input'
Check ($script:A.Pattern.Current.Value -eq 'old') 'Adjacent-label resolution must preserve other input values'

Setup
$written=Request @{ x=70; y=80; text='' }
Check ($written.value -eq '' -and $script:Writes[0] -eq 'destination') 'Clearing an empty field still resolves its target'

Setup
$native=Element 'native edit exposed as Pane' 'Pane' 150 15 300 30
$native.Current.NativeWindowHandle=7
[MockAE]::Native=$native; [XpWin]::NativeFocus=[IntPtr]7
Check (Test-TextLike (Get-InputFocus)) 'Use exact native edit focus when UIA focused element is a Pane'

Write-Output 'PASS: worker syntax; readonly filtering; stable selection; closed/changed-window guard; adjacent label; empty clear; native Edit focus.'
