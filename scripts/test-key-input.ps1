# Runs the actual worker parser and actual XpInput C# methods.
# Only OS keyboard events, layout lookup and sleeps are replaced with recorders.
# This script never injects input into a Windows desktop.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$common = [IO.File]::ReadAllText((Join-Path $root 'a11y/common.ps1')).Replace("`r`n", "`n")
$mark = $common.IndexOf('public static class XpInput')
if ($mark -lt 0) { throw 'XpInput class was not found.' }
$start = $common.LastIndexOf('using System;', $mark)
$end = $common.IndexOf("`n" + '"@', $mark)
if ($start -lt 0 -or $end -lt 0) { throw 'XpInput C# block was not found.' }
$code = $common.Substring($start, $end - $start)
$nativeEvent = '[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
$nativeScan = '[DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern short VkKeyScanW(char ch);'
if (-not $code.Contains($nativeEvent) -or -not $code.Contains($nativeScan)) { throw 'Native declarations changed; update the test seam explicitly.' }
$recorder = @'
  public static List<string> Events = new List<string>();
  public static HashSet<int> Pressed = new HashSet<int>();
  public static int SleepCount, FailSleepAt, FailReleaseVk;
  public static void TestReset(int sleepAt, int releaseVk) {
    Events.Clear(); Pressed.Clear(); SleepCount = 0;
    FailSleepAt = sleepAt; FailReleaseVk = releaseVk;
  }
  static void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra) {
    bool up = (flags & 2u) != 0;
    Events.Add(vk.ToString("X2") + ":" + flags);
    if (up && vk == FailReleaseVk) {
      FailReleaseVk = 0;
      throw new InvalidOperationException("Injected release failure");
    }
    if (up) Pressed.Remove(vk); else Pressed.Add(vk);
  }
  static void TestSleep(int milliseconds) {
    SleepCount++;
    if (SleepCount == FailSleepAt) throw new ThreadInterruptedException("Injected sleep interruption");
  }
'@
$scan = @'
  static short VkKeyScanW(char ch) {
    if (ch == '#') return (short)0x0133;
    if (ch == '+') return (short)0x01BB;
    return -1;
  }
'@
$code = $code.Replace($nativeEvent, $recorder).Replace($nativeScan, $scan).Replace('Thread.Sleep(', 'TestSleep(')
Add-Type -TypeDefinition $code
Add-Type -TypeDefinition @'
namespace System.Windows.Forms {
  public static class SendKeys {
    public static System.Collections.Generic.List<string> Sent = new System.Collections.Generic.List<string>();
    public static void SendWait(string value) { Sent.Add(value); }
  }
}
'@
$worker = Join-Path $root 'a11y/worker.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($worker, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $fn.Extent.Text
}

$checks = 0
function Check($condition, [string]$message) {
  if (-not $condition) { throw $message }
  $script:checks++
}
function Reset-RecordedKeys([int]$sleepAt = 0, [int]$releaseVk = 0) {
  [XpInput]::TestReset($sleepAt, $releaseVk)
  [System.Windows.Forms.SendKeys]::Sent.Clear()
}
function Check-Events([string[]]$expected, [string]$message) {
  $actual = @([XpInput]::Events)
  Check (($actual -join '|') -ceq ($expected -join '|')) "$message; got: $($actual -join '|')"
  Check ([XpInput]::Pressed.Count -eq 0) "$message left a key pressed"
}

foreach ($legacy in @('+a', '+s', 'A', 'a+b', '^s', '%{F4}', '^{ESC}', '{ENTER}', '{#}', '+(ec)', 'kaydet')) {
  Reset-RecordedKeys
  Send-KeyString $legacy
  Check (@([XpInput]::Events).Count -eq 0) "Legacy value was rerouted: $legacy"
  Check (@([System.Windows.Forms.SendKeys]::Sent).Count -eq 1 -and [System.Windows.Forms.SendKeys]::Sent[0] -ceq $legacy) "Legacy value changed: $legacy"
}

$valid = @(
  @{ key='win+r'; events=@('5B:1','52:0','52:2','5B:3') },
  @{ key='win+d'; events=@('5B:1','44:0','44:2','5B:3') },
  @{ key='win+e'; events=@('5B:1','45:0','45:2','5B:3') },
  @{ key='win+tab'; events=@('5B:1','09:0','09:2','5B:3') },
  @{ key='WIN + R'; events=@('5B:1','52:0','52:2','5B:3') },
  @{ key='win+shift+s'; events=@('5B:1','10:0','53:0','53:2','10:2','5B:3') },
  @{ key='ctrl+s'; events=@('11:0','53:0','53:2','11:2') },
  @{ key='ctrl+shift+s'; events=@('11:0','10:0','53:0','53:2','10:2','11:2') },
  @{ key='alt+f4'; events=@('12:0','73:0','73:2','12:2') },
  @{ key='enter'; events=@('0D:0','0D:2') },
  @{ key='tab'; events=@('09:0','09:2') },
  @{ key='esc'; events=@('1B:0','1B:2') },
  @{ key='f5'; events=@('74:0','74:2') },
  @{ key='down'; events=@('28:1','28:3') },
  @{ key='up'; events=@('26:1','26:3') },
  @{ key='win+'; events=@('5B:1','5B:3') },
  @{ key='rwin+r'; events=@('5C:1','52:0','52:2','5C:3') },
  @{ key='#r'; events=@('5B:1','52:0','52:2','5B:3') },
  @{ key='#'; events=@('5B:1','5B:3') },
  @{ key='{WIN}'; events=@('5B:1','5B:3') },
  @{ key='{LWIN}'; events=@('5B:1','5B:3') },
  @{ key='{RWIN}'; events=@('5C:1','5C:3') },
  @{ key='#+s'; events=@('5B:1','10:0','53:0','53:2','10:2','5B:3') }
)
foreach ($case in $valid) {
  Reset-RecordedKeys
  Send-KeyString $case.key
  Check-Events $case.events $case.key
  Check (@([System.Windows.Forms.SendKeys]::Sent).Count -eq 0) "Shortcut became literal text: $($case.key)"
}

foreach ($invalid in @('ctrl+[', 'ctrl+nope', 'ctrl++s', 'ctrl+', 'ctrl+shift', 'ctrl+shift+', 'win+rwin+', 'win+{TAB}', 'ctrl+f4%{ENTER}', '#r{NOPE}', '#rΩ')) {
  Reset-RecordedKeys
  $failed = $false
  try { Send-KeyString $invalid } catch { $failed = $true }
  Check $failed "Invalid shortcut was accepted: $invalid"
  Check (@([XpInput]::Events).Count -eq 0 -and @([System.Windows.Forms.SendKeys]::Sent).Count -eq 0) "Invalid shortcut sent input: $invalid"
}

# Interrupt after a modifier, or after the target key, has actually gone down.
foreach ($key in @('win+r', '#r', 'ctrl+shift+s')) {
  foreach ($at in @(1, 2)) {
    Reset-RecordedKeys $at
    $failed = $false
    try { Send-KeyString $key } catch { $failed = $true }
    Check $failed "Fault was not injected for $key at $at"
    Check ([XpInput]::Events.Count -gt 0 -and [XpInput]::Pressed.Count -eq 0) "Exception left keys pressed for $key at $at"
  }
}
Reset-RecordedKeys 1
$failed = $false
try { Send-KeyString '{WIN}' } catch { $failed = $true }
Check ($failed -and [XpInput]::Pressed.Count -eq 0) 'Interrupted bare Windows tap left Win pressed'

# Even a failed target-key release must not skip releasing Windows.
Reset-RecordedKeys 0 0x52
$failed = $false
try { Send-KeyString 'win+r' } catch { $failed = $true }
Check $failed 'A failed native release must report an error'
Check (-not [XpInput]::Pressed.Contains(0x5B)) 'A failed R release skipped Windows cleanup'
Check ([XpInput]::Events.Contains('5B:3')) 'Windows key-up was not attempted after another release failed'

Write-Output "PASS: $checks checks; real parser and native method event order; legacy values unchanged; invalid input sends nothing; modifier and target-key exception cleanup. No desktop input injected."
