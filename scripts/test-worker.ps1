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
 public static System.Collections.Generic.Dictionary<long,string> Classes = new System.Collections.Generic.Dictionary<long,string>();
 public static System.Collections.Generic.Dictionary<long,string> Texts = new System.Collections.Generic.Dictionary<long,string>();
 public static System.Collections.Generic.Dictionary<long,int> Styles = new System.Collections.Generic.Dictionary<long,int>();
 public static IntPtr FocusHandle(){return NativeFocus;}
 public static IntPtr GetForegroundWindow(){return new IntPtr(1);}
 public static string ClassOf(IntPtr h){ string c; if (Classes.TryGetValue(h.ToInt64(), out c)) return c; return h.ToInt64()==7 ? "Edit" : ""; }
 public static int GetWindowLong(IntPtr h,int i){ int s; return Styles.TryGetValue(h.ToInt64(), out s) ? s : 0; }
 // Like the real helper: the control's text, or null when it cannot be read.
 public static string ReadText(IntPtr h){ string t; return Texts.TryGetValue(h.ToInt64(), out t) ? t : null; }
 // EM_SETSEL 0..-1: records the call and, when allowed, marks the text as selected.
 public static bool SelectAllResult = true;
 public static int SelectAllCalls = 0;
 public static bool Selected = false;
 public static bool SelectAll(IntPtr h){ SelectAllCalls++; if (SelectAllResult) Selected = true; return SelectAllResult; }
}
public static class XpText { public static bool CanType(string t){ return true; } }
namespace System.Windows.Forms {
 // Records keys instead of sending them, so the test never types into a real window.
 public static class SendKeys {
  public static System.Collections.Generic.List<string> Sent = new System.Collections.Generic.List<string>();
  public static System.Action<string> OnKey = null;
  public static void SendWait(string k){ Sent.Add(k); if (OnKey != null) OnKey(k); }
 }
}
public static class XpInput {
 public sealed class Hit {
  public int[] Mods;
  public int Vk;
  public int Times;
 }
 public static System.Collections.Generic.List<Hit> Chords = new System.Collections.Generic.List<Hit>();
 public static System.Collections.Generic.List<string> Plain = new System.Collections.Generic.List<string>();
 public static void Chord(int[] mods, int vk, int times) {
  if (mods == null) mods = new int[0];
  Chords.Add(new Hit { Mods = mods, Vk = vk, Times = times });
 }
 public static string Combo(string[] names) {
  if (names == null || names.Length == 0) return "EMPTY";
  Plain.Add(string.Join("+", names));
  return "";
 }
 public static int ScanChar(char ch) {
  if (ch == '#') return (1 << 8) | 0x33;
  if (ch == '+') return (1 << 8) | 0xBB;
  return -1;
 }
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

# --- A classic Win32 form (FolderBatcher): UIA reports every control as a Pane, with no ValuePattern anywhere. ---
# Positions are the ones measured on the real window. The edit boxes keep their text in the UIA name.
function NativePane($id,$name,$x,$y,$width,$height,$handle,$class,$style) {
  $e = Element $id 'Pane' $x $y $width $height
  $e.Current.Name = $name
  $e.Current.NativeWindowHandle = $handle
  [XpWin]::Classes[[long]$handle] = $class
  [XpWin]::Styles[[long]$handle] = $style
  return $e
}
function SetupForm {
  $script:TypeChoiceCache.Clear(); $script:Writes.Clear(); [System.Windows.Forms.SendKeys]::Sent.Clear()
  [System.Windows.Forms.SendKeys]::OnKey = $null
  [XpWin]::SelectAllCalls = 0; [XpWin]::Selected = $false; [XpWin]::SelectAllResult = $true
  [XpWin]::NativeFocus=[IntPtr]::Zero; [XpWin]::Classes.Clear(); [XpWin]::Texts.Clear(); [XpWin]::Styles.Clear()
  $script:Form = Element 'Dosya Klasorleyici' 'Window' 570 80 780 618
  $kids = @()
  $fields = @(@('Kaynak klasor',172,''), @('Hedef klasor',214,''), @('Grup boyutu',256,'20'), @('En fazla dosya',298,'0'), @('Dosya filtresi',340,'*'))
  $handle = 100
  foreach ($f in $fields) {
    $handle++; $kids += (NativePane "label $($f[0])" $f[0] 598 $f[1] 215 24 $handle 'Static' 0x50000100)
    $handle++; $kids += (NativePane "edit $($f[0])" $f[2] 818 ($f[1] - 6) 420 30 $handle 'Edit' 0x50010080)
    [XpWin]::Texts[[long]$handle] = $f[2]
  }
  # The read-only info box at the bottom: an Edit with ES_READONLY (0x800).
  $kids += (NativePane 'info box' 'Sureler saniye' 598 554 710 125 300 'Edit' 0x50200844)
  [XpWin]::Texts[300] = 'Sureler saniye'
  $script:Form.Children = $kids
  foreach ($el in $kids) { $el.Parent = $script:Form }
  [MockAE]::Front=$script:Form; [MockAE]::FocusedElement=$script:Form; [MockAE]::Point=$script:Form
}
$sourceHandle = 102   # "Kaynak klasor" edit box
$labelClick = @{ x = 705; y = 184 }   # centre of the "Kaynak klasor" caption (598,172 215x24)

SetupForm
$first = Request @{ text='' }
Check $first.needChoice 'Without a click, five boxes need a choice'
Check ($first.choices.Count -eq 5) 'Five writable boxes; the read-only info box must not be a candidate'
Check ($first.choices[0].label -eq 'Kaynak klasor' -and $first.choices[2].label -eq 'Grup boyutu') 'Each box is named by the caption on its row'
Check ($first.choices[0].native -eq 'Edit' -and $first.choices[0].type -eq 'Pane') 'The real window class is reported next to what UIA says'
Check ($first.choices[2].value -eq '20' -and $first.choices[2].valueKnown) 'The real text is read, not reported as empty'
Check ($first.choices[0].value -eq '' -and $first.choices[0].valueKnown) 'A truly empty box is known to be empty'
Check (@($first.choices | Where-Object { $_.related }).Count -eq 0) 'Without a click, no caption points at a box'

SetupForm
$r = Request @{ text=''; x=$labelClick.x; y=$labelClick.y }
Check (-not $r.needChoice) 'Clicking a Static caption must resolve to its box without asking the model'
Check ($script:Writes.Count -eq 0) 'Boxes without a ValuePattern are typed into, not set'
Check ([MockAE]::FocusedElement.Id -eq 'edit Kaynak klasor') 'The box right of the clicked caption gets the focus'
Check (($script:Form.Children | Where-Object { $_.Id -eq 'edit Kaynak klasor' }).Id -eq [MockAE]::FocusedElement.Id) 'Only that box is focused'
Check ([System.Windows.Forms.SendKeys]::Sent -contains '^a' -and [System.Windows.Forms.SendKeys]::Sent -contains '{DEL}') 'Clearing selects all and deletes inside the focused box'
Check ($r.value -eq '') 'The cleared box is read back as empty from the native text'

SetupForm
[XpWin]::Texts[[long]$sourceHandle] = 'C:\Resimler'   # what the box holds after the keys were sent
$r = Request @{ text='C:\Resimler'; x=$labelClick.x; y=$labelClick.y }
Check (-not $r.needChoice -and $r.value -eq 'C:\Resimler') 'The written text is read back from the native box, so the write can be verified'

SetupForm
$other = @{ x = 705; y = 226 }   # the "Hedef klasor" caption (598,214)
$r = Request @{ text=''; x=$other.x; y=$other.y }
Check ([MockAE]::FocusedElement.Id -eq 'edit Hedef klasor') 'Another caption resolves to its own box'

SetupForm
[XpWin]::Styles[110] = 0x50010080 -bor 0x20   # ES_PASSWORD on the fifth box (handle 110)
[XpWin]::Texts[[long]108] = $null
[void][XpWin]::Texts.Remove(108)               # the fourth box (handle 108): an app that does not answer in time
$first = Request @{ text='' }
Check ($first.choices.Count -eq 5) 'Password and unreadable boxes are still candidates'
Check (-not $first.choices[4].valueKnown -and $first.choices[4].value -eq '') 'A password box is never read; its text is unknown, not empty'
Check (-not $first.choices[3].valueKnown) 'A box that cannot be read in time is unknown, not empty'
Check ($first.choices[2].valueKnown -and $first.choices[2].value -eq '20') 'Other boxes are still read'

# --- Clearing a box that ignores Ctrl+A (FolderBatcher). The fake keyboard behaves like the box under test. ---
# $script:CtrlA says whether Ctrl+A selects the text. Delete removes the text only while it is selected.
# Any single typed character is appended, like a real edit box.
function UseKeyboard($ctrlAWorks) {
  $script:CtrlA = $ctrlAWorks
  [System.Windows.Forms.SendKeys]::OnKey = [Action[string]]{
    param($key)
    $h = [long]102
    if ($key -eq '^a') { if ($script:CtrlA) { [XpWin]::Selected = $true } }
    elseif ($key -eq '{DEL}') { if ([XpWin]::Selected) { [XpWin]::Texts[$h] = ''; [XpWin]::Selected = $false } }
    elseif ($key.Length -eq 1) { [XpWin]::Texts[$h] = [string][XpWin]::Texts[$h] + $key }
  }
}

SetupForm; UseKeyboard $false; [XpWin]::Texts[[long]102] = 'OLD PATH'
$r = Request @{ text=''; x=$labelClick.x; y=$labelClick.y }
Check ([XpWin]::SelectAllCalls -eq 1) 'When Ctrl+A leaves text behind, the box is selected with EM_SETSEL'
Check ([XpWin]::Texts[[long]102] -eq '' -and $r.value -eq '') 'The box is empty after the fallback, and read back as empty'

SetupForm; UseKeyboard $false; [XpWin]::Texts[[long]102] = 'OLD PATH'
$r = Request @{ text='NEW'; x=$labelClick.x; y=$labelClick.y }
Check ($r.value -eq 'NEW') 'Typing after the fallback replaces the old text instead of appending to it'

SetupForm; UseKeyboard $true; [XpWin]::Texts[[long]102] = 'OLD PATH'
$r = Request @{ text='NEW'; x=$labelClick.x; y=$labelClick.y }
Check ([XpWin]::SelectAllCalls -eq 0) 'Where Ctrl+A works the fallback is never used'
Check ($r.value -eq 'NEW') 'Where Ctrl+A works the result is the same as before'

SetupForm; UseKeyboard $false; [XpWin]::Texts[[long]102] = 'OLD PATH'; [XpWin]::SelectAllResult = $false
$r = Request @{ text=''; x=$labelClick.x; y=$labelClick.y }
Check ([XpWin]::SelectAllCalls -eq 1 -and $r.value -eq 'OLD PATH') 'If EM_SETSEL does not answer, nothing else is deleted'

SetupForm; UseKeyboard $false; [void][XpWin]::Texts.Remove(102)
$r = Request @{ text=''; x=$labelClick.x; y=$labelClick.y }
Check ([XpWin]::SelectAllCalls -eq 0) 'A box whose text cannot be read is left to Ctrl+A alone'

SetupForm; UseKeyboard $false; [XpWin]::Texts[[long]102] = 'OLD PATH'; [XpWin]::Styles[102] = 0x50010080 -bor 0x20
$r = Request @{ text=''; x=$labelClick.x; y=$labelClick.y }
Check ([XpWin]::SelectAllCalls -eq 0) 'A password box is never read, so the fallback is not used on it'

# --- Tuş Gönder: Windows key, without sending the rest of SendKeys down a new path. ---
function Reset-Keys {
  [System.Windows.Forms.SendKeys]::Sent.Clear()
  [XpInput]::Chords.Clear()
  [XpInput]::Plain.Clear()
}
function KeyOp([string]$keys) {
  Reset-Keys
  [void](Invoke-Op 'keys' ([pscustomobject]@{ keys = $keys }))
}
function Check-Sent([string]$expect, [string]$message) {
  $sent = @([System.Windows.Forms.SendKeys]::Sent)
  $chords = @([XpInput]::Chords)
  $plain = @([XpInput]::Plain)
  if ($sent.Count -ne 1 -or [string]$sent[0] -ne $expect -or $chords.Count -ne 0 -or $plain.Count -ne 0) {
    throw "$message (sent=[$($sent -join '|')] chords=$($chords.Count) plain=$($plain.Count))"
  }
}
function Check-Plain([string]$expect, [string]$message) {
  $plain = @([XpInput]::Plain)
  $sent = @([System.Windows.Forms.SendKeys]::Sent)
  $chords = @([XpInput]::Chords)
  if ($plain.Count -ne 1 -or [string]$plain[0] -ne $expect -or $sent.Count -ne 0 -or $chords.Count -ne 0) {
    throw "$message (plain=[$($plain -join '|')] sent=$($sent.Count) chords=$($chords.Count))"
  }
}
function Check-Chord([int]$index, [int]$vk, [int]$times, $mods, [string]$message) {
  if ($null -eq $mods) { $mods = @() }
  $expect = @($mods)
  $all = @([XpInput]::Chords)
  if ($all.Count -le $index) { throw "$message (missing chord $index, have $($all.Count))" }
  $c = $all[$index]
  if ([int]$c.Vk -ne $vk -or [int]$c.Times -ne $times) { throw "$message (vk $($c.Vk) x$($c.Times), want $vk x$times)" }
  $got = @($c.Mods | Where-Object { $null -ne $_ })
  if ($got.Count -ne $expect.Count) { throw "$message (mods $($got -join '+') != $($expect -join '+'))" }
  for ($n = 0; $n -lt $expect.Count; $n++) {
    if ([int]$got[$n] -ne [int]$expect[$n]) { throw "$message (mods $($got -join '+') != $($expect -join '+'))" }
  }
}
function Check-NoSend([string]$message) {
  if (@([System.Windows.Forms.SendKeys]::Sent).Count -ne 0) { throw "$message (SendKeys was used)" }
  if (@([XpInput]::Plain).Count -ne 0) { throw "$message (plain chord was used)" }
}

KeyOp '^s'
Check-Sent '^s' 'Ctrl+S stays on SendKeys'
KeyOp '{ENTER}'
Check-Sent '{ENTER}' 'Enter stays on SendKeys'
KeyOp '%{F4}'
Check-Sent '%{F4}' 'Alt+F4 stays on SendKeys'
KeyOp '^{ESC}'
Check-Sent '^{ESC}' 'Ctrl+Esc stays on SendKeys'
KeyOp '{#}'
Check-Sent '{#}' 'A braced hash is a literal hash, not the Windows key'
KeyOp '+(ec)'
Check-Sent '+(ec)' 'A grouped shortcut with no Windows key stays on SendKeys'
KeyOp ''
Check-Sent '' 'An empty shortcut still goes to SendKeys'

$only = @(Invoke-Op 'keys' ([pscustomobject]@{ keys = '#r' }))
Check ($only.Count -eq 1 -and $only[0] -eq $true) 'A Windows shortcut returns only true, with no extra output'

KeyOp '#r'
Check-NoSend 'Win+R must not go through SendKeys'
Check (@([XpInput]::Chords).Count -eq 1) 'Win+R is one shortcut'
Check-Chord 0 0x52 1 @(0x5B) 'Win+R holds Left Windows and taps R'

KeyOp '#e'
Check-Chord 0 0x45 1 @(0x5B) 'Win+E holds Left Windows and taps E without Shift'

KeyOp '#E'
Check-Chord 0 0x45 1 @(0x5B, 0x10) 'Win+Shift+E when the letter is uppercase'

KeyOp '#+s'
Check-Chord 0 0x53 1 @(0x5B, 0x10) 'Win+Shift+S is the snip shortcut'

KeyOp '#{F4}'
Check-Chord 0 0x73 1 @(0x5B) 'Win+F4'

KeyOp '#'
Check-Chord 0 0x5B 1 @() 'A lone # taps the Windows key'

KeyOp '{WIN}'
Check-Chord 0 0x5B 1 @() '{WIN} taps the Windows key'
KeyOp '{lwin}'
Check-Chord 0 0x5B 1 @() '{LWIN} taps the left Windows key'
KeyOp '{RWIN}'
Check-Chord 0 0x5C 1 @() '{RWIN} taps the right Windows key'
KeyOp '{WIN 2}'
Check-Chord 0 0x5B 2 @() '{WIN 2} repeats the Windows key'

KeyOp '^(#e)'
Check-Chord 0 0x45 1 @(0x11, 0x5B) 'A group can hold Ctrl and Windows together'

KeyOp '#(er)'
Check (@([XpInput]::Chords).Count -eq 2) 'Win held for a group is one shortcut per key'
Check-Chord 0 0x45 1 @(0x5B) 'Grouped Win+E'
Check-Chord 1 0x52 1 @(0x5B) 'Grouped Win+R'

KeyOp '^s#e'
Check-NoSend 'A mixed string that contains Windows is not split back to SendKeys'
Check-Chord 0 0x53 1 @(0x11) 'Ctrl+S still happens before the Windows shortcut'
Check-Chord 1 0x45 1 @(0x5B) 'Win+E follows Ctrl+S'

KeyOp '{WIN}{ENTER}'
Check-Chord 0 0x5B 1 @() 'Windows key in a sequence'
Check-Chord 1 0x0D 1 @() 'Enter after the Windows key is the real Enter key'

KeyOp '#{#}'
Check-Chord 0 0x33 1 @(0x5B, 0x10) 'Win plus a literal hash uses the keyboard layout, not a second Windows key'

$bad = ''
try { KeyOp '#{NOPE}' } catch { $bad = [string]$_.Exception.Message }
Check ($bad -match 'NOPE') 'An unknown key names itself'
Check (@([XpInput]::Chords).Count -eq 0) 'A bad Windows shortcut presses nothing'

KeyOp 'win+r'
Check-Plain 'win+r' 'win+r opens Run'
KeyOp 'WIN+R'
Check-Plain 'win+r' 'Plain shortcuts ignore case'
KeyOp 'win + r'
Check-Plain 'win+r' 'Spaces around + are ignored'
KeyOp 'win+'
Check-Plain 'win' 'win+ is the Windows key on its own'
KeyOp 'ctrl+s'
Check-Plain 'ctrl+s' 'ctrl+s'
KeyOp 'alt+f4'
Check-Plain 'alt+f4' 'alt+f4'
KeyOp 'enter'
Check-Plain 'enter' 'enter'
KeyOp 'tab'
Check-Plain 'tab' 'tab'
KeyOp 'esc'
Check-Plain 'esc' 'esc'
KeyOp 'f5'
Check-Plain 'f5' 'f5'
KeyOp 'down'
Check-Plain 'down' 'down'
KeyOp 'up'
Check-Plain 'up' 'up'
KeyOp 'win+d'
Check-Plain 'win+d' 'win+d'
KeyOp 'win+e'
Check-Plain 'win+e' 'win+e'
KeyOp 'win+tab'
Check-Plain 'win+tab' 'win+tab'
KeyOp 'ctrl+shift+s'
Check-Plain 'ctrl+shift+s' 'ctrl+shift+s keeps order'
KeyOp 'kaydet'
Check-Sent 'kaydet' 'A single unknown word is still typed through SendKeys'

$bad = ''
try { KeyOp 'ctrl+nope' } catch { $bad = [string]$_.Exception.Message }
Check ($bad -match 'nope') 'An unknown plain piece names itself'
Check (@([XpInput]::Plain).Count -eq 0 -and @([System.Windows.Forms.SendKeys]::Sent).Count -eq 0) 'A bad plain shortcut presses nothing'

Write-Output 'PASS: worker syntax; readonly filtering; stable selection; closed/changed-window guard; adjacent label; empty clear; native Edit focus; classic Win32 form (Static captions, native text, password and unreadable boxes); clearing a box that ignores Ctrl+A; Windows key shortcuts (#, {WIN}, {LWIN}, {RWIN}) and plain shortcuts (win+r, ctrl+s) while old SendKeys strings stay on SendKeys.'
