# Real worker dispatcher; OS cursor/window APIs and button injection are recorders.
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/worker.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Op'},$true)
Invoke-Expression $fn.Extent.Text
# Verify the call against the REAL production declarations, not an invented mock.
$commonTokens=$null; $commonErrors=$null
$common=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/common.ps1'),[ref]$commonTokens,[ref]$commonErrors)
if ($commonErrors.Count) { throw ($commonErrors | Out-String) }
$native=$common.FindAll({param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class XpNative \{'},$true) | Select-Object -First 1
$win=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class XpWin \{'},$true) | Select-Object -First 1
Add-Type -TypeDefinition ($native.Value.Replace('class XpNative {','class NativeDeclarationCheck {'))
Add-Type -TypeDefinition ($win.Value.Replace('class XpWin {','class WinDeclarationCheck {'))
$case=$fn.Find({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true).Clauses | Where-Object {$_.Item1.Value -eq 'moveAt'}
if ($case.Item2.Extent.Text -notmatch '\[XpNative\]::SetCursorPos') { throw 'moveAt must use the actual XpNative cursor API' }
$m=[NativeDeclarationCheck].GetMethod('SetCursorPos')
if (-not $m -or $m.ReturnType -ne [bool] -or -not $m.IsPublic -or -not $m.IsStatic) { throw 'Missing production native move method' }
Add-Type -TypeDefinition @'
using System;
public static class XpWin {
 public static int Root = 42;
 public static IntPtr RootAt(int x,int y) { return new IntPtr(Root); }
 public static int ProcessOf(IntPtr hwnd) { return 10; }
}
public static class XpNative {
 public static bool MoveOk = true;
 public static int Moves;
 public static System.Collections.Generic.List<int> Buttons = new System.Collections.Generic.List<int>();
 public static bool SetCursorPos(int x,int y) { Moves++; return MoveOk; }
 public static void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra) { Buttons.Add((int)flags); }
}
'@
function Set-HudHandle { }
$script:clicks=0; $script:cursor=[pscustomobject]@{X=10;Y=20}
function Get-CursorPoint { return $script:cursor }
function Invoke-MouseAt { param($x,$y,$button) $script:clicks++; $script:clicked=[pscustomobject]@{x=$x;y=$y;button=$button} }
function Reject($op,$p,$code) {
 try { [void](Invoke-Op $op $p); throw 'Expected rejection' }
 catch { if (-not $_.Exception.Message.Contains($code)) { throw } }
}
$r=Invoke-Op 'moveAt' ([pscustomobject]@{x=10;y=20})
if ([XpNative]::Moves -ne 1 -or $script:clicks -ne 0 -or $r.hwnd -ne 42) { throw 'Move injected click or failed to record window' }
[XpNative]::MoveOk=$false
Reject 'moveAt' ([pscustomobject]@{x=10;y=20}) 'INPUT_MOVE_FAILED'
[XpNative]::MoveOk=$true
$warn = Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=10;y=20})
if ($script:clicks -lt 1 -or [string]$warn.warning -notlike '*INPUT_CLICK_STALE*') { throw 'Missing hover window must click and warn' }
[XpWin]::Root=99
$warn = Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42})
if ([string]$warn.warning -notlike '*INPUT_CLICK_STALE*') { throw 'Changed window must click and warn' }
[XpWin]::Root=42; $script:cursor=[pscustomobject]@{X=100;Y=200}
$beforeDrift = $script:clicks
$warn = Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42})
if ($script:clicks -le $beforeDrift -or [string]$warn.warning -notlike '*INPUT_CLICK_STALE*') { throw 'Cursor drift must click at the current point and warn' }
$script:cursor=[pscustomobject]@{X=11;Y=20}
[void](Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=10;y=20;hwnd=42}))
if ($script:clicks -ne 1 -or $script:clicked.x -ne 11) { throw 'Did not click at actual current pointer' }
foreach ($mode in @('left','double','right')) {
 [void](Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=11;y=20;hwnd=42;button=$mode;ownPid=99}))
 if ($script:clicked.button -ne $mode) { throw 'Current pointer operation changed the selected click mode' }
}
$before=$script:clicks
Reject 'clickCurrentAt' ([pscustomobject]@{x=11;y=20;hwnd=42;button='invalid'}) 'INPUT_CLICK_MODE'
Reject 'clickCurrentAt' ([pscustomobject]@{x=11;y=20;hwnd=42;button='left';ownPid=10}) 'INPUT_SELF_TARGET'
if ($script:clicks -ne $before) { throw 'Invalid mode/self-target sent input' }
# Run the REAL mouse dispatcher too. The native API above only records, never sends OS input.
$screenTokens=$null; $screenErrors=$null
$screenAst=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/screen.ps1'),[ref]$screenTokens,[ref]$screenErrors)
if ($screenErrors.Count) { throw ($screenErrors | Out-String) }
$mouseFn=$screenAst.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-MouseAt'},$true)
Invoke-Expression $mouseFn.Extent.Text
foreach ($mode in @('left','double','right')) {
 [XpNative]::Buttons.Clear();$movesBefore=[XpNative]::Moves
 [void](Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=11;y=20;hwnd=42;button=$mode;ownPid=99}))
 $expected=if($mode -eq 'double'){4}else{2}
 if ([XpNative]::Buttons.Count -ne $expected -or [XpNative]::Moves -ne $movesBefore) { throw 'Guarded current click warped pointer or changed button count' }
}
[XpNative]::Buttons.Clear();$script:cursorReads=0
function Get-CursorPoint {
 $script:cursorReads++
 if ($script:cursorReads -eq 1) { return [pscustomobject]@{X=11;Y=20} }
 return [pscustomobject]@{X=500;Y=500}
}
[void](Invoke-Op 'clickCurrentAt' ([pscustomobject]@{x=11;y=20;hwnd=42;button='left';ownPid=99}))
if ([XpNative]::Buttons.Count -eq 0) { throw 'A later cursor read must not cancel a click that already started' }
Write-Output 'PASS: actual worker move sends no click; failed movement rejects; missing window, changed window and cursor drift click with a warning; valid current click uses fresh cursor. OS APIs mocked.'
