# Real worker dispatcher; OS cursor/window APIs and button injection are recorders.
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/worker.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Op'},$true)
Invoke-Expression $fn.Extent.Text
Add-Type -TypeDefinition @'
using System;
public static class XpWin {
 public static bool MoveOk = true;
 public static int Root = 42, Moves;
 public static bool SetCursorPos(int x,int y) { Moves++; return MoveOk; }
 public static IntPtr RootAt(int x,int y) { return new IntPtr(Root); }
}
'@
function Set-HudHandle { }
$script:clicks=0; $script:cursor=[pscustomobject]@{X=10;Y=20}
function Get-CursorPoint { return $script:cursor }
function Invoke-MouseAt { param($x,$y,$button) $script:clicks++; $script:clicked=[pscustomobject]@{x=$x;y=$y} }
function Reject($op,$p,$code) {
 try { [void](Invoke-Op $op $p); throw 'Expected rejection' }
 catch { if (-not $_.Exception.Message.Contains($code)) { throw } }
}
$r=Invoke-Op 'moveAt' ([pscustomobject]@{x=10;y=20})
if ([XpWin]::Moves -ne 1 -or $script:clicks -ne 0 -or $r.hwnd -ne 42) { throw 'Move injected click or failed to record window' }
[XpWin]::MoveOk=$false
Reject 'moveAt' ([pscustomobject]@{x=10;y=20}) 'INPUT_MOVE_FAILED'
[XpWin]::MoveOk=$true
Reject 'clickCurrentAt' ([pscustomobject]@{x=10;y=20}) 'INPUT_CLICK_STALE'
[XpWin]::Root=99
Reject 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42}) 'INPUT_CLICK_STALE'
[XpWin]::Root=42; $script:cursor=[pscustomobject]@{X=100;Y=200}
Reject 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42}) 'INPUT_CLICK_STALE'
if ($script:clicks -ne 0) { throw 'Rejected action sent click' }
$script:cursor=[pscustomobject]@{X=11;Y=20}
[void](Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42}))
if ($script:clicks -ne 1 -or $script:clicked.x -ne 11) { throw 'Did not click at actual current pointer' }
Write-Output 'PASS: actual worker move sends no click; failed movement, missing window, changed window and cursor drift reject; valid current click uses fresh cursor. OS APIs mocked.'
