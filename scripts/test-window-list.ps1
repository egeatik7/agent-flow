# Actual window enumeration and title matching, with only the UIA/native boundary
# replaced. No real desktop input is sent. Run in a fresh PowerShell process.
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot '../a11y/common.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
Add-Type -TypeDefinition @'
using System;
public class WindowListAE { public static object RootElement = new object(); }
public static class XpNative {
  public static bool IsWindowVisible(IntPtr h) { return h.ToInt64() != 3; }
  public static bool IsCloaked(IntPtr h) { return h.ToInt64() == 4; }
}
'@
$script:AE = [WindowListAE]
$script:Windows = @()
$script:Walker = New-Object PSObject
$script:Walker | Add-Member ScriptMethod GetFirstChild { param($root) if ($script:Windows.Count) { return $script:Windows[0] } }
$script:Walker | Add-Member ScriptMethod GetNextSibling {
  param($current)
  for ($i = 0; $i -lt $script:Windows.Count; $i++) {
    if ([object]::ReferenceEquals($script:Windows[$i], $current)) {
      if ($i + 1 -lt $script:Windows.Count) { return $script:Windows[$i + 1] }
      return $null
    }
  }
  throw 'Unexpected walker element'
}
foreach ($name in @('Get-TopWindows', 'Test-UsableWindow', 'Find-WindowOrNull', 'Find-Window')) {
  $fn = $ast.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }, $true)
  if (-not $fn) { throw "Missing production function: $name" }
  Invoke-Expression $fn.Extent.Text
}
function Window($name, $handle, $pidValue) {
  return [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name; NativeWindowHandle = $handle; ProcessId = $pidValue } }
}
$checks = 0
function Check($ok, $message) { if (-not $ok) { throw $message }; $script:checks++ }
Check (@(Get-TopWindows).Count -eq 0) 'Empty desktop must produce zero elements'
$script:Windows = @((Window 'Nubbo Click Test Host' 1 11), (Window 'Notes - Editor' 2 22),
  (Window 'Hidden' 3 33), (Window 'Cloaked' 4 44), (Window '' 5 55))
$all = @(Get-TopWindows)
Check ($all.Count -eq 4) 'Every named window must be a separate pipeline element'
Check ($all[0].Current.Name -eq 'Nubbo Click Test Host') 'First element must be a window, not an ArrayList'
Check (@(Get-TopWindows 11).Count -eq 3) 'Own PID must be excluded'
Check ([object]::ReferenceEquals((Find-Window 'Nubbo Click Test Host'), $script:Windows[0])) 'Exact title match must work with multiple windows'
Check ([object]::ReferenceEquals((Find-Window 'click test'), $script:Windows[0])) 'Case-insensitive substring must work'
Check ([object]::ReferenceEquals((Find-Window 'Old Notes - Editor'), $script:Windows[1])) 'App suffix fallback must work'
Check ($null -eq (Find-WindowOrNull 'Hidden')) 'Invisible windows must be excluded'
Check ($null -eq (Find-WindowOrNull 'Cloaked')) 'Cloaked windows must be excluded'
Check ($null -eq (Find-WindowOrNull 'Missing')) 'Missing window must remain missing'
$script:Windows = @((Window 'Only window' 1 11))
Check (@(Get-TopWindows).Count -eq 1) 'Single-window desktop must retain one element'
Check ((Find-Window 'Only window').Current.Name -eq 'Only window') 'Single-window title lookup must work'
Write-Output "PASS: window enumeration and title lookup ($checks checks; no real input)"
