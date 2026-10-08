$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'test-input-recovery.ps1')
function Get-InputFocus { throw 'UIA must not be consulted for explicit keyboard input' }
function Get-BoundWindow { throw 'Window classifier must not gate explicit input' }
[XpText]::Direct=$true
foreach ($old in @('', 'D:\Unrelated\old.png')) {
 [System.Windows.Forms.SendKeys]::Sent.Clear();[System.Windows.Forms.SendKeys]::FieldText=$old
 $r=Invoke-Op 'typeText' @{keyboard=$true;guard=@{window=$target};text='hello';clearFirst=$true;x=662;y=462}
 Check ($r.writeSent -and $r.cleared -and $r.via -eq 'keyboard' -and $null -eq $r.value) 'Explicit custom replacement is sent without UIA/caret/value checks'
 Check ([System.Windows.Forms.SendKeys]::FieldText -eq 'hello') 'Replacement removes old contents'
 $keys=[System.Windows.Forms.SendKeys]::Sent
 Check ($keys[0] -eq '^a' -and $keys[1] -eq '{DEL}' -and -not $keys.Contains('^c')) 'Ctrl+A/Delete/text only, no copy probe'
}
[System.Windows.Forms.SendKeys]::Sent.Clear();[System.Windows.Forms.SendKeys]::FieldText='prefix'
$r=Invoke-Op 'typeText' @{keyboard=$true;text='hello';clearFirst=$false}
Check ([System.Windows.Forms.SendKeys]::FieldText -eq 'prefixhello' -and -not $r.cleared) 'Append never selects/deletes old text'
Check (-not [System.Windows.Forms.SendKeys]::Sent.Contains('^a') -and -not [System.Windows.Forms.SendKeys]::Sent.Contains('{DEL}')) 'Append has no clear keys'
[XpText]::Direct=$false;[System.Windows.Forms.SendKeys]::FieldText=''
$r=Invoke-Op 'typeText' @{keyboard=$true;text=$unicode;clearFirst=$false}
Check ($r.pasted -and [System.Windows.Forms.SendKeys]::FieldText -eq $unicode) 'Unicode is pasted through current field'
Check ([System.Windows.Forms.Clipboard]::GetText() -eq 'old clipboard') 'Clipboard text restored'
Check ([System.Windows.Forms.Clipboard]::Current.GetData('Binary',$false).Length -eq 3) 'Clipboard binary restored'
[System.Windows.Forms.Clipboard]::FailSet=$true
$before=[System.Windows.Forms.SendKeys]::Sent.Count
Throws {Invoke-Op 'typeText' @{keyboard=$true;text=$unicode;clearFirst=$false}} 'CLIPBOARD_SET_FAILED' 'Real clipboard failure is propagated'
Check (@([System.Windows.Forms.SendKeys]::Sent|Select-Object -Skip $before) -notcontains '^v') 'Failed clipboard never pastes stale contents'
[System.Windows.Forms.Clipboard]::FailSet=$false
$script:LastKeyWindow=$script:Window;[XpWin]::Foreground=200
$before=$script:Keys.Count
Invoke-Op 'keys' @{direct=$true;keys='^a'}|Out-Null
Check ($script:Keys.Count -eq $before+1) 'Explicit key action is not vetoed by stale remembered window'
Write-Host "PASS: $script:Checks combined legacy/direct dispatcher checks; OS input mocked."

[XpWin]::Foreground=100;[XpWin]::UnderPoint=100
Throws {Invoke-Op 'typeText' @{keyboard=$true;ownPid=10;text='bad';clearFirst=$true}} 'INPUT_SELF_TARGET' 'Nubbo self input is excluded by actual PID'
Throws {Invoke-Op 'keys' @{direct=$true;ownPid=10;keys='^a'}} 'INPUT_SELF_TARGET' 'Nubbo self keys are excluded by actual PID'
Throws {Invoke-Op 'hotkey' @{ownPid=10;keys=@('ctrl','a')}} 'INPUT_SELF_TARGET' 'Initiative hotkey cannot bypass self-target exclusion'
Throws {Invoke-Op 'clickAt' @{ownPid=10;x=10;y=20;button='left'}} 'INPUT_SELF_TARGET' 'Nubbo self click is excluded by actual PID'
Write-Host "PASS: $script:Checks checks including self-target scope; OS APIs mocked."

[XpWin]::Live=$false
Throws {Invoke-Op 'typeText' @{keyboard=$true;guard=@{window=$target};text='bad';clearFirst=$true}} 'INPUT_WINDOW_CLOSED' 'Known closed window is an actual failure'
Throws {Invoke-Op 'keys' @{direct=$true;target=$target;keys='^a'}} 'INPUT_WINDOW_CLOSED' 'Known closed key target is an actual failure'
Throws {Invoke-Op 'clickAt' @{target=$target;x=10;y=20;button='left'}} 'INPUT_WINDOW_CLOSED' 'Known closed click target is an actual failure'
[XpWin]::Live=$true
$wrong=@{hwnd='100';pid=999;title='wrong'}
Throws {Invoke-Op 'typeText' @{keyboard=$true;guard=@{window=$wrong};text='bad';clearFirst=$true}} 'INPUT_WINDOW_CLOSED' 'Actual PID mismatch remains an error'
Write-Host "PASS: $script:Checks checks including known closed/PID mismatch; OS APIs mocked."
