# Actual worker functions against fake Windows/UIA/clipboard boundaries.
# No real mouse, keyboard or clipboard is touched, on Windows or Linux.
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot '../a11y/worker.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $worker), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Compile the real native declarations without executing a P/Invoke.
$native = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $a.Value -match 'public static class XpWin \{' }, $true) | Select-Object -First 1
if (-not $native) { throw 'Missing real XpWin declarations' }
Add-Type -TypeDefinition ($native.Value.Replace('class XpWin {', 'class NativeCompileCheck {'))
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace System.Windows.Automation { public class ValuePattern { public static object Pattern = new object(); } }
public class MockAE {
 public static Dictionary<long,object> Elements = new Dictionary<long,object>();
 public static object FocusedElement;
 public static object FromHandle(IntPtr h) { object e; return Elements.TryGetValue(h.ToInt64(), out e) ? e : null; }
}
public static class XpWin {
 public static long Foreground=100, Focus=110, UnderPoint=100;
 public static bool Live=true, Enabled=true, HasCaret=true;
 public static int TargetPid=10;
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static IntPtr FocusHandle(){return new IntPtr(Focus);}
 public static bool IsWindow(IntPtr h){return Live;}
 public static bool IsWindowEnabled(IntPtr h){return Enabled;}
 public static int ProcessOf(IntPtr h){return h.ToInt64()==200 ? 20 : TargetPid;}
 public static IntPtr RootOf(IntPtr h){return new IntPtr(h.ToInt64()==210 ? 200 : h.ToInt64()==110 ? 100 : h.ToInt64());}
 public static IntPtr RootAt(int x,int y){return new IntPtr(UnderPoint);}
 public static bool IsOwnedBy(IntPtr h,IntPtr owner){return h.ToInt64()==101 && owner.ToInt64()==100;}
 public static string ClassOf(IntPtr h){return "TkChild";}
 public static int GetWindowLong(IntPtr h,int i){return 0;}
 public class INFO { public IntPtr hwndFocus,hwndCaret; }
 public static INFO FocusData(){return new INFO { hwndFocus=new IntPtr(Focus), hwndCaret=HasCaret ? new IntPtr(Focus) : IntPtr.Zero };}
 public class RECT { public int left,top,right,bottom; }
 public static RECT BoundsOf(IntPtr h){return new RECT { left=100,top=400,right=600,bottom=430 };}
 public static RECT CaretBounds(INFO i){return new RECT { left=300,top=405,right=301,bottom=425 };}
}
public static class XpText { public static bool Direct=true; public static bool CanType(string t){return Direct;} }
namespace System.Windows.Forms {
 public class DataObject {
  public Dictionary<string,object> Data = new Dictionary<string,object>();
  public string[] GetFormats(bool convert){var a=new string[Data.Count];Data.Keys.CopyTo(a,0);return a;}
  public object GetData(string format,bool convert){object o;return Data.TryGetValue(format,out o)?o:null;}
  public void SetData(string format,bool convert,object value){Data[format]=value;}
 }
 public static class Clipboard {
  public static DataObject Current = new DataObject();
  public static bool FailCopy=false;
  public static DataObject GetDataObject(){return Current;}
  public static void SetDataObject(DataObject d,bool copy){Current=d;}
  public static void SetText(string t){Current=new DataObject();Current.SetData("Text",false,t);}
  public static bool ContainsText(){return Current.Data.ContainsKey("Text");}
  public static string GetText(){return (string)Current.GetData("Text",false);}
 }
 public static class SendKeys {
  public static List<string> Sent = new List<string>();
  public static string FieldText="";
  public static bool LoseFocusOnDelete=false;
  public static void SendWait(string key){
   Sent.Add(key);
   if(key=="^c" && !Clipboard.FailCopy) Clipboard.SetText(FieldText);
   else if(key=="^v") FieldText+=Clipboard.GetText();
   else if(key=="{DEL}"){FieldText="";if(LoseFocusOnDelete) XpWin.Focus=210;}
   else if(key!="^a" && key!="^c" && key!="{ENTER}") FieldText+=key;
  }
 }
}
'@
foreach ($fn in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { Invoke-Expression $fn.Extent.Text }
$script:AE = [MockAE]; $script:TypeChoiceCache = @{}
function Start-Sleep { param($Milliseconds,$Seconds) }
function Set-HudHandle($p) {}
function Get-CT($el) { return [string]$el.Current.ControlType }
function Test-Same($a,$b) { return $a.Id -eq $b.Id }
function Get-TopLevel($el) { while ($el.Parent) { $el=$el.Parent }; return $el }
function Enter-Window($el) { if ($script:AllowActivation) { [XpWin]::Foreground = $el.Current.NativeWindowHandle } }
function Find-Window($title) { if ($title -eq 'Renamer') { return $script:Window }; throw 'WINDOW_NOT_FOUND' }
function Get-TypeChoices($ownPid,$x,$y) { return $script:Choices }
function Invoke-MouseAt($x,$y,$button) { [void]$script:Mouse.Add(@($x,$y,$button)) }
function Send-KeyString($keys) { [void]$script:Keys.Add($keys) }
$script:Walker = [pscustomobject]@{}
$script:Walker | Add-Member ScriptMethod GetParent { param($el) return $el.Parent }
function Element($handle,$ct,$parent=$null) {
 $e=[pscustomobject]@{ Id=$handle; Parent=$parent; Current=[pscustomobject]@{ Name='Renamer'; ControlType=$ct; NativeWindowHandle=$handle; ProcessId=10; IsEnabled=$true; IsOffscreen=$false; IsKeyboardFocusable=($ct -eq 'Edit'); BoundingRectangle=[pscustomobject]@{ X=0; Y=0; Width=1000; Height=700; IsEmpty=$false } }; ReadOnly=$null }
 $e | Add-Member ScriptMethod TryGetCurrentPattern { param($pattern,[ref]$p) if ($null -eq $this.ReadOnly) { return $false }; $p.Value=[pscustomobject]@{ Current=[pscustomobject]@{ IsReadOnly=$this.ReadOnly; Value='old' } }; return $true }
 $e | Add-Member ScriptMethod SetFocus { [XpWin]::Focus=$this.Id }
 return $e
}
$script:Window=Element 100 'Window'; $field=Element 110 'Pane' $script:Window
[MockAE]::Elements[100]=$script:Window; [MockAE]::Elements[110]=$field; [MockAE]::Elements[101]=(Element 101 'Window'); [MockAE]::Elements[200]=(Element 200 'Window')
[MockAE]::FocusedElement=$field
$target=@{ hwnd='100'; pid=10; title='Renamer'; rect=@{ x=0;y=0;w=1000;h=700 } }
$guard=@{ window=$target; at=@{x=300;y=415}; visual=$true }
$script:Checks=0; $script:Mouse=New-Object System.Collections.ArrayList; $script:Keys=New-Object System.Collections.ArrayList; $script:Choices=@();$script:AllowActivation=$true
function Check($ok,$message) { $script:Checks++; if (-not $ok) { throw "FAILED: $message" } }
function Throws($body,$match,$message) { $failed=$false; try { & $body | Out-Null } catch { $failed=$_.Exception.Message -match $match }; Check $failed $message }
Check (-not (Test-TextLike $field)) 'An arbitrary Tk Pane is not automatically writable'
Check (Test-VisualInput $guard) 'Explicit visual focus + correct child/root/rect/caret can authorize replacement'
$guard.visual=$false; Check (-not (Test-VisualInput $guard)) 'No visual recovery request, no Pane bypass'; $guard.visual=$true
[XpWin]::HasCaret=$false; Check (-not (Test-VisualInput $guard)) 'Missing native caret refuses custom input'; [XpWin]::HasCaret=$true
$guard.at.x=800; Check (-not (Test-VisualInput $guard)) 'A point outside the focused child refuses custom input';$guard.at.x=300
$field.Current.ControlType='Button';Check (-not (Test-VisualInput $guard)) 'Button cannot become custom text field';$field.Current.ControlType='Pane'
$field.ReadOnly=$true;Check (-not (Test-VisualInput $guard)) 'Read-only provider refuses input';$field.ReadOnly=$null
[XpWin]::Enabled=$false;Check (-not (Test-VisualInput $guard)) 'Disabled native child refuses input';[XpWin]::Enabled=$true
[XpWin]::Focus=210;Check (-not (Test-VisualInput $guard)) 'Native focus/caret in another window refuses input';[XpWin]::Focus=110
[XpWin]::Foreground=200;Throws {Get-BoundWindow $target} 'INPUT_WINDOW_NOT_ACTIVE' 'Inactive target is rejected by action guard'
$t=Get-InputTarget @{target=$target;ownPid=999};Check ($t.hwnd -eq '100' -and [XpWin]::Foreground -eq 100) 'Exact inactive target can be activated explicitly'
$script:AllowActivation=$false;[XpWin]::Foreground=200;Throws {Get-InputTarget @{target=$target}} 'INPUT_WINDOW_NOT_ACTIVE' 'Activation denial stops before input';$script:AllowActivation=$true;[XpWin]::Foreground=100
[XpWin]::TargetPid=11;Throws {Get-InputTarget @{target=$target}} 'INPUT_WINDOW_CLOSED' 'Reused HWND with different PID is rejected';[XpWin]::TargetPid=10
[XpWin]::Live=$false;Throws {Get-InputTarget @{target=$target}} 'INPUT_WINDOW_CLOSED' 'Closed target is rejected';[XpWin]::Live=$true
Throws {Get-InputTarget @{target=$target;ownPid=10}} 'INPUT_TARGET_INVALID' 'Nubbo cannot type into its own process'
$script:Window.Current.BoundingRectangle.Width=900;Throws {Invoke-Op 'clickAt' @{target=$target;x=300;y=415;button='left'}} 'INPUT_LAYOUT_CHANGED' 'Window resize rejects stale click';$script:Window.Current.BoundingRectangle.Width=1000
[XpWin]::UnderPoint=200;Throws {Invoke-Op 'clickAt' @{target=$target;x=300;y=415;button='left'}} 'INPUT_CLICK_OCCLUDED' 'Overlapping other window rejects click';[XpWin]::UnderPoint=100
Check ($script:Mouse.Count -eq 0) 'No mouse action during all guard failures'
[XpWin]::Foreground=101;$t=Get-InputTarget @{target=$target;followOwnedDialog=$true};Check ($t.hwnd -eq '101') 'Actual owned modal dialog may be followed'
[XpWin]::Foreground=200;$t=Get-InputTarget @{target=$target;followOwnedDialog=$true};Check ($t.hwnd -eq '100') 'Unrelated foreground window is not adopted as a dialog'
# One unrelated discoverable field must require an explicit choice, not be overwritten.
$script:Choices=@([pscustomobject]@{id=1;token='t';window='Renamer';type='Edit';native='Edit';name='Other';value='old';valueKnown=$true;label='';clicked=$false;related=$false;el=$field})
$r=Invoke-Op 'typeText' @{text='hello';clearFirst=$true;guard=$guard;x=300;y=415}
Check ($r.needChoice -and -not $r.writeSent) 'Sole unrelated candidate is not auto-selected under a guard'
Check ([System.Windows.Forms.SendKeys]::Sent.Count -eq 0) 'Unrelated field receives no clear or text keys'
$script:Choices=@()
# Clipboard copy verifies fresh field text, not a previously copied matching string.
[System.Windows.Forms.Clipboard]::Current.SetData('Text',$false,'old clipboard')
[System.Windows.Forms.Clipboard]::Current.SetData('Binary',$false,[byte[]]@(1,2,3))
[System.Windows.Forms.SendKeys]::FieldText='hello'
$value=Read-VisualInput $field $guard '110'
Check ($value -eq 'hello') 'Fresh field copy is read back'
Check ([System.Windows.Forms.Clipboard]::GetText() -eq 'old clipboard') 'Text clipboard restored after verification'
Check ([System.Windows.Forms.Clipboard]::Current.GetData('Binary',$false).Length -eq 3) 'Non-text clipboard formats also restored'
[System.Windows.Forms.Clipboard]::FailCopy=$true
Throws {Read-VisualInput $field $guard '110'} 'INPUT_READBACK_UNAVAILABLE' 'Failed copy cannot verify stale matching clipboard text'
Check ([System.Windows.Forms.Clipboard]::GetText() -eq 'old clipboard') 'Clipboard restored even if copy fails'
[System.Windows.Forms.Clipboard]::FailCopy=$false
[System.Windows.Forms.SendKeys]::Sent.Clear();[System.Windows.Forms.SendKeys]::FieldText=''
$r=Invoke-Op 'typeText' @{text='hello';clearFirst=$true;guard=$guard;x=300;y=415;pressEnter=$false}
Check ($r.value -eq 'hello' -and $r.via -eq 'visual-caret' -and $r.writeSent -and $r.focusHwnd -eq '110') 'Empty custom field supports guarded replacement and mandatory readback'
Check (-not [System.Windows.Forms.SendKeys]::Sent.Contains('{ENTER}')) 'Typing worker does not submit when not requested'
Invoke-Op 'keys' @{keys='{ENTER}';target=$target;focusHwnd='110'} | Out-Null
Check ($script:Keys.Count -eq 1) 'Verified field can receive final Enter'
[XpWin]::Focus=210
Throws {Invoke-Op 'keys' @{keys='{ENTER}';target=$target;focusHwnd='110'}} 'INPUT_FOCUS_CHANGED' 'Focus loss after write prevents Enter'
Check ($script:Keys.Count -eq 1) 'No second Enter sent to another field';[XpWin]::Focus=110
[System.Windows.Forms.SendKeys]::Sent.Clear()
Throws {Invoke-Op 'typeText' @{text='hello';clearFirst=$false;guard=$guard;x=300;y=415}} 'INPUT_CUSTOM_APPEND_UNSUPPORTED' 'Unknown custom append position is not silently replaced'
Check ([System.Windows.Forms.SendKeys]::Sent.Count -eq 0) 'Unsupported custom append sends no text or selection'
[System.Windows.Forms.SendKeys]::LoseFocusOnDelete=$true
Throws {Invoke-Op 'typeText' @{text='hello';clearFirst=$true;guard=$guard;x=300;y=415}} 'INPUT_FOCUS_CHANGED' 'Focus loss during delete stops before character input'
Check (-not [System.Windows.Forms.SendKeys]::Sent.Contains('h')) 'No character is typed after focus loss'
Write-Host "PASS: $script:Checks recovery worker checks; native declarations compile; no desktop input."
# Recovery crops must intersect the requested window, not expand into a neighbour.
function Get-VirtualScreen { return @{x=0;y=0;w=1000;h=700} }
function Get-ScreenBitmap($rect) {
 $b=[pscustomobject]@{};$b | Add-Member ScriptMethod Dispose { $script:Disposed=$true };return $b
}
function ConvertTo-JpegBase64($bmp,$items,$rect,$marks,$maxW,$snap,$fit) { $script:CropOptions=@($maxW,$snap,$fit);return @{data='mock';w=$rect.w;h=$rect.h} }
$script:Disposed=$false
$r=Invoke-Op 'crop' @{x=-500;y=100;w=1000;h=300;maxW=1008;snap=28;fit=$true}
Check ($r.area.x -eq 0 -and $r.area.w -eq 500 -and $r.area.y -eq 100 -and $r.area.h -eq 300) 'Partly offscreen window is cropped to its real visible part'
Check ($script:Disposed -and $script:CropOptions[0] -eq 1008 -and $script:CropOptions[1] -eq 28 -and $script:CropOptions[2]) 'Bitmap disposed; crop scaling options preserved'
Throws {Invoke-Op 'crop' @{x=-1500;y=100;w=1000;h=300}} 'INPUT_CAPTURE_OUTSIDE' 'Fully offscreen region does not capture a neighbour'
Write-Host "PASS: $script:Checks total recovery worker checks including clipped crops."

[XpWin]::Focus=110; [System.Windows.Forms.SendKeys]::LoseFocusOnDelete=$false; [XpText]::Direct=$false
$unicode = ([string][char]0xE7) + ([string][char]0x131) + ([string][char]0x11F)
$r=Invoke-Op 'typeText' @{text=$unicode;clearFirst=$true;guard=$guard;x=300;y=415;pressEnter=$false}
Check ($r.value -eq $unicode -and $r.pasted) 'Unicode custom replacement uses guarded paste and real readback'
Check ([System.Windows.Forms.Clipboard]::GetText() -eq 'old clipboard') 'Clipboard text preserved across custom paste and readback'
Check ([System.Windows.Forms.Clipboard]::Current.GetData('Binary',$false).Length -eq 3) 'Other clipboard formats preserved across custom paste and readback'
Write-Host "PASS: $script:Checks total recovery worker checks including Unicode clipboard path."
