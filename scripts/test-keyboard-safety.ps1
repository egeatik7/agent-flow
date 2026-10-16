param([switch]$Native)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$production = [IO.File]::ReadAllText((Join-Path $root 'a11y/keyboard.cs'))
# Production policy, fake OS boundary. This intentionally does not send desktop input.
$fixture = @'
public sealed class TestKeyboard : IXpKeyboardPlatform {
  public List<int> Keys = new List<int>();
  public bool Available = true, ReleaseWorks = true, NaturalUp;
  public int Releases, Waits, MaxRelease = 99;
  public bool DesktopAvailable() { return Available; }
  public int[] Down() { return Keys.ToArray(); }
  public int Release(int[] keys) {
    Releases++;
    if (!ReleaseWorks) return 0;
    int count = Math.Min(keys.Length, MaxRelease);
    for (int i = 0; i < count; i++) Keys.Remove(keys[i]);
    return count;
  }
  public void Wait(int ms) { Waits++; if (NaturalUp) Keys.Clear(); }
}
'@
Add-Type -TypeDefinition ($production + [Environment]::NewLine + $fixture)
function Assert($value, [string]$message) { if (-not $value) { throw $message }; Write-Output "PASS $message" }
$p = New-Object TestKeyboard; $s = [XpKeyboardSafety]::new($p); $s.Before(); $s.After()
Assert ($p.Releases -eq 0 -and $p.Waits -eq 0) 'neutral keyboard is unchanged and has no added delay'
$p.Keys.Add(0xA2); $s.Before()
Assert ($p.Keys.Count -eq 0 -and $p.Releases -eq 1) 'stale left Ctrl is released before input'
$p = New-Object TestKeyboard; $p.Keys.Add(0xA2); $p.Keys.Add(0xA3); $s = [XpKeyboardSafety]::new($p); $s.Before()
Assert ($p.Keys.Count -eq 0) 'both Ctrl sides are checked'
$p = New-Object TestKeyboard; $p.Keys.Add(0xA2); $p.NaturalUp = $true; $s = [XpKeyboardSafety]::new($p); $s.Before()
Assert ($p.Releases -eq 0 -and $p.Waits -gt 0) 'an arriving natural key-up needs no synthetic repair'
$p = New-Object TestKeyboard; $p.Available = $false; $s = [XpKeyboardSafety]::new($p); $failed = $false
try { $s.Before() } catch { $failed = $_.Exception.Message.Contains('INPUT_DESKTOP_UNAVAILABLE') }
Assert ($failed -and $p.Releases -eq 0) 'unavailable desktop is not interpreted as all keys released'
$p = New-Object TestKeyboard; $p.Keys.Add(0xA2); $p.ReleaseWorks = $false; $s = [XpKeyboardSafety]::new($p); $failed = $false
try { $s.Before() } catch { $failed = $_.Exception.Message.Contains('INPUT_MODIFIERS_HELD') }
Assert ($failed -and $p.Releases -eq 3) 'failed release is bounded and never authorizes the next input'
$p = New-Object TestKeyboard; $p.Keys.Add(0xA2); $p.Keys.Add(0xA5); $p.MaxRelease = 1; $s = [XpKeyboardSafety]::new($p); $s.Before()
Assert ($p.Keys.Count -eq 0 -and $p.Releases -eq 2) 'partial native insertion is retried against current state'
$p = New-Object TestKeyboard; $s = [XpKeyboardSafety]::new($p); $s.Before(); $p.Keys.Add(0xA3); $p.Keys.Add(0xA4); $s.After()
Assert ($p.Keys.Count -eq 0) 'post-action cleanup releases remaining modifiers'
foreach ($name in @('common.ps1','worker.ps1','screen.ps1')) {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root "a11y/$name"), [ref]$tokens, [ref]$errors)
  Assert ($errors.Count -eq 0) "$name parses without syntax errors"
}
# Exercise the production Combo body, replacing only the native key emission boundary.
$tokens = $null; $errors = $null
$common = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'a11y/common.ps1'), [ref]$tokens, [ref]$errors)
$inputCode = $common.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class XpInput \{' }, $true) | Select-Object -First 1
$signature = '[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
$stub = @'
public static List<string> Events = new List<string>();
public static int DownCount, FailDownNumber, FailReleaseKey;
static void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra) {
  bool up = (flags & 2) != 0;
  Events.Add(vk + (up ? ":up" : ":down"));
  if (!up && ++DownCount == FailDownNumber) throw new InvalidOperationException("test down failure");
  if (up && vk == FailReleaseKey) throw new InvalidOperationException("test up failure");
}
'@
Assert ($null -ne $inputCode -and $inputCode.Value.Contains($signature)) 'production key injection boundary found'
Add-Type -TypeDefinition ($inputCode.Value.Replace($signature, $stub))
[void][XpInput]::Combo(@('ctrl','shift','s'))
Assert (([XpInput]::Events -join ',') -eq '17:down,16:down,83:down,83:up,16:up,17:up') 'normal chord press/release order remains intact'
[XpInput]::Events.Clear(); [XpInput]::DownCount = 0; [XpInput]::FailDownNumber = 2
try { [void][XpInput]::Combo(@('ctrl','shift','s')) } catch {}
Assert (([XpInput]::Events -join ',') -eq '17:down,16:down,16:up,17:up') 'a failed modifier press still releases every recorded key'
[XpInput]::Events.Clear(); [XpInput]::DownCount = 0; [XpInput]::FailDownNumber = 0; [XpInput]::FailReleaseKey = 16
$failed = $false
try { [void][XpInput]::Combo(@('ctrl','shift','s')) } catch { $failed = $_.Exception.Message.Contains('KEY_RELEASE_FAILED') }
Assert ($failed -and [XpInput]::Events[[XpInput]::Events.Count - 1] -eq '17:up') 'one release exception cannot skip Ctrl release'
[XpInput]::Events.Clear(); [XpInput]::FailReleaseKey = 0
$result = [XpInput]::Combo(@('ctrl','not-a-key'))
Assert ($result.StartsWith('UNKNOWN_KEY') -and [XpInput]::Events.Count -eq 0) 'an invalid shortcut sends no key-down'
# Can be run only on the user's Windows test machine; no key-down is generated here.
if ($Native) {
  Assert ([XpKeyboardGuard]::Available()) 'native active desktop can be inspected'
  [XpKeyboardGuard]::Before(); [XpKeyboardGuard]::After()
  Assert ([XpKeyboardGuard]::Down().Length -eq 0) 'native modifier state is neutral after cleanup'
}
