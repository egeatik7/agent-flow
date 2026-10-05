# Tests current helper/worker functions with fake UIA objects. No Windows input.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
function Import-TestFunction([string]$file, [string]$name) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
  $fn = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }, $true) | Select-Object -First 1
  if (-not $fn) { throw "Function missing: $name" }
  Invoke-Expression $fn.Extent.Text
  Set-Item "Function:global:$name" (Get-Item "Function:$name").ScriptBlock
}
Add-Type -TypeDefinition @'
namespace System.Windows.Automation {
 public enum TreeScope { Descendants }
 public class PropertyCondition { public PropertyCondition(object property, string value) {} }
}
public class TestAE {
 public static object NameProperty = new object();
 public static object AutomationIdProperty = new object();
}
'@
$script:AE = [TestAE]
if (-not ('XpWin' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
public static class XpWin {
  public static IntPtr Foreground = IntPtr.Zero;
  public static int ForegroundPid = 0;
  public static IntPtr GetForegroundWindow() { return Foreground; }
  public static int ProcessOf(IntPtr h) { return ForegroundPid; }
  public static bool IsWindow(IntPtr h) { return true; }
  public static bool IsOwnedBy(IntPtr a, IntPtr b) { return false; }
  public static IntPtr RootAt(int x, int y) { return IntPtr.Zero; }
}
'@
}
$common = Join-Path $root 'a11y/common.ps1'
foreach ($name in @('Test-LocatorIdentity', 'Find-ByLocator', 'Find-Window')) {
  Import-TestFunction $common $name
}
foreach ($name in @('Invoke-Op', 'Test-SystemShortcut', 'Assert-KeyWindowActive', 'Get-PlainChord', 'Test-PlainKey', 'Test-PlainModifier', 'Test-SendKeysHasWin')) {
  Import-TestFunction (Join-Path $root 'a11y/worker.ps1') $name
}
function Get-CT($e) { return [string]$e.Current.ControlType }
function Resolve-RelPath($top, $path) { return $script:PathHit }
function Find-WindowOrNull($title) { return $script:Window }
function Enter-Window($win) { $script:Entered++ }
function Send-KeyString($keys) { [void]$script:Keys.Add([string]$keys) }
function Set-HudHandle($payload) {}
$top = [pscustomobject]@{}
$top | Add-Member -MemberType ScriptMethod -Name FindAll -Value { param($scope, $condition) return ,$script:Candidates }
function Element($name, $aid, $ct) { return [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name; AutomationId = $aid; ControlType = $ct } } }
$script:Checks = 0
function Check([bool]$ok, [string]$message) {
  $script:Checks++
  if (-not $ok) { throw "FAILED: $message" }
}
$wanted = @{ name = 'Save'; automationId = 'save-id'; controlType = 'Button'; path = '0/1' }
$right = Element 'Save' 'save-id' 'Button'
foreach ($wrong in @(
  (Element 'Save' 'save-id' 'Text'),
  (Element 'Save' 'wrong-id' 'Button'),
  (Element 'Other' 'save-id' 'Button')
)) {
  $script:PathHit = $wrong; $script:Candidates = @($wrong)
  Check ($null -eq (Find-ByLocator $top $wanted)) 'Mismatched path/first search result must not be accepted'
}
$script:PathHit = $right; $script:Candidates = @()
Check ([object]::ReferenceEquals((Find-ByLocator $top $wanted), $right)) 'Matching path remains supported'
$script:PathHit = $null; $script:Candidates = @((Element 'Save' 'save-id' 'Text'), $right)
Check ([object]::ReferenceEquals((Find-ByLocator $top $wanted), $right)) 'Search skips a wrong control and finds the valid candidate'
$script:PathHit = $null; $script:Candidates = @((Element 'Save' 'new-id' 'Button'))
Check ($null -ne (Find-ByLocator $top @{ name = 'Save'; controlType = 'Button' })) 'Name/type-only locator remains supported'
$script:PathHit = $right; $script:Candidates = @()
Check ($null -ne (Find-ByLocator $top @{ path = '0/1' })) 'Explicit path-only locator remains supported'

$script:Keys = New-Object 'System.Collections.Generic.List[string]'
$script:Entered = 0
$script:Window = $null
$threw = $false
try { Invoke-Op 'keys' @{ keys = 'win+r'; windowTitle = 'Missing Blender' } | Out-Null }
catch { $threw = $_.Exception.Message -like '*WINDOW_NOT_FOUND*' }
Check $threw 'Missing specified window must produce WINDOW_NOT_FOUND'
Check ($script:Keys.Count -eq 0) 'No key is sent to an unrelated foreground window'
Invoke-Op 'keys' @{ keys = '^s'; windowTitle = '' } | Out-Null
Check ($script:Keys.Count -eq 1 -and $script:Keys[0] -eq '^s') 'Unspecified window preserves legacy SendKeys text'
$script:Window = [pscustomobject]@{ Current = [pscustomobject]@{ Name = 'Blender'; NativeWindowHandle = [IntPtr]([long]99); ProcessId = 4242 } }
Invoke-Op 'keys' @{ keys = 'win+r'; windowTitle = 'Blender' } | Out-Null
Check ($script:Entered -eq 1 -and $script:Keys[1] -eq 'win+r') 'Found target window preserves shortcut dispatch'

# A Windows shortcut is meant to leave the target application, so another program in front is fine.
[XpWin]::Foreground = [IntPtr]([long]77); [XpWin]::ForegroundPid = 5151
$before = $script:Keys.Count
Invoke-Op 'keys' @{ keys = 'win+d'; windowTitle = 'Blender' } | Out-Null
Check ($script:Keys.Count -eq ($before + 1) -and $script:Keys[$before] -eq 'win+d') 'A Windows shortcut is sent while another program is in front'

# A shortcut for the target application must not land in another program.
$threw = $false
try { Invoke-Op 'keys' @{ keys = '^s'; windowTitle = 'Blender' } | Out-Null } catch { $threw = $_.Exception.Message -like '*INPUT_WINDOW_NOT_ACTIVE*' }
Check $threw 'An application shortcut is refused while another program is in front'
Check ($script:Keys.Count -eq ($before + 1)) 'The refused shortcut sent nothing'

# A window of the same process counts as the same application: Blender's save window.
[XpWin]::Foreground = [IntPtr]([long]78); [XpWin]::ForegroundPid = 4242
Invoke-Op 'keys' @{ keys = '^s'; windowTitle = 'Blender' } | Out-Null
Check ($script:Keys.Count -eq ($before + 2)) 'A shortcut is sent while a window of the same application is in front'

# The target window itself in front is the everyday case.
[XpWin]::Foreground = [IntPtr]([long]99); [XpWin]::ForegroundPid = 4242
Invoke-Op 'keys' @{ keys = '^s'; windowTitle = 'Blender' } | Out-Null
Check ($script:Keys.Count -eq ($before + 3)) 'A shortcut is sent while the target window itself is in front'

Write-Host "PASS: $script:Checks stability worker checks; no desktop keys sent."
