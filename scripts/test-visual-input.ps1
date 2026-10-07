# Executes production geometry rules without loading Windows APIs or sending input.
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Test-RectPoint', 'Get-VisualInputGeometryRejection')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "Missing production function: $name" }
  Invoke-Expression $fn.Extent.Text
}
function Evidence {
  return [pscustomobject]@{ type='Pane'; native='TkChild'; readOnly=$null; focusHwnd='42'; rect=[pscustomobject]@{x=0;y=0;w=900;h=700}; caret=[pscustomobject]@{hwnd='42';x=500;y=450;w=2;h=18} }
}
$guard = [pscustomobject]@{at=[pscustomobject]@{x=118;y=462};window=[pscustomobject]@{rect=[pscustomobject]@{w=900;h=700}}}
$checks = 0
function Check($d, $expected) {
  $actual = Get-VisualInputGeometryRejection $d $guard
  if ($actual -ne $expected) { throw "Expected '$expected', got '$actual'" }
  $script:checks++
}
Check (Evidence) '' # Previously rejected solely because Tk reports a large container.
$d=Evidence; $d.native='OtherPane'; Check $d 'FOCUS_TOO_TALL'
$d=Evidence; $d.caret.y=200; Check $d 'TK_CLICK_NOT_ON_CARET_LINE'
$d=Evidence; $d.caret.hwnd='99'; Check $d 'TK_CARET_NOT_FOCUSED_CHILD'
$d=Evidence; $d.caret=$null; Check $d 'NO_NATIVE_CARET'
$d=Evidence; $d.caret.h=0; Check $d 'NO_NATIVE_CARET'
$d=Evidence; $d.caret.w=20; Check $d 'TK_INVALID_CARET'
$d=Evidence; $d.readOnly=$true; Check $d 'READ_ONLY'
$d=Evidence; $d.type='Button'; Check $d 'NON_INPUT_CONTROL'
$d=Evidence; $d.rect.w=100; Check $d 'CLICK_OUTSIDE_FOCUS'
$d=Evidence; $d.caret.x=1000; Check $d 'CARET_OUTSIDE_FOCUS'
$d=Evidence; $d.rect.w=1000; Check $d 'FOCUS_TOO_WIDE'
# Exercise the actual wrapper too; only native window APIs are replaced.
Add-Type -TypeDefinition @'
using System;
public static class XpWin {
  public static bool WrongRoot, Enabled = true;
  public static IntPtr RootOf(IntPtr h) { return new IntPtr(WrongRoot ? 99 : 10); }
  public static bool IsWindowEnabled(IntPtr h) { return Enabled; }
}
'@
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-VisualInput' }, $true)
Invoke-Expression $fn.Extent.Text
function Get-BoundWindow { param($window, $activate) return $window }
function Get-InputDiagnostics { return Evidence }
$guard | Add-Member visual $true
$guard.window | Add-Member hwnd '10'
if (-not (Test-VisualInput $guard)) { throw 'Valid Tk native caret rejected' }; $checks++
[XpWin]::WrongRoot=$true
if ((Test-VisualInput $guard) -or $script:VisualInputRejection -ne 'WRONG_WINDOW') { throw 'Wrong window accepted' }; $checks++
[XpWin]::WrongRoot=$false; [XpWin]::Enabled=$false
if ((Test-VisualInput $guard) -or $script:VisualInputRejection -ne 'FOCUS_DISABLED') { throw 'Disabled window accepted' }; $checks++
[XpWin]::Enabled=$true; $guard.visual=$false
if ((Test-VisualInput $guard) -or $script:VisualInputRejection -ne 'VISUAL_FOCUS_REQUIRED') { throw 'Unverified visual focus accepted' }; $checks++
Write-Output "PASS: $checks production checks (native APIs mocked; no desktop input)."
