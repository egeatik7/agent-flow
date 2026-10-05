param(
  [ValidateSet('Keys','Package')][string]$Mode = 'Keys',
  [string]$Output = 'out/windows-finish',
  [string]$Executable = 'release/Nubbo.exe'
)
# Real input, on a disposable Windows desktop only. No API key or model calls.
# Observations below are independent of Nubbo's worker, which sends the input.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = [IO.Path]::GetFullPath((Join-Path $root $Output))
[void][IO.Directory]::CreateDirectory($out)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class FinishOracle {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Kbd { public uint vk, scan, flags, time; public UIntPtr extra; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a,uint b,bool attach);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id,HookProc cb,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int code,IntPtr message,IntPtr data);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint msg,UIntPtr w,IntPtr l);
  public sealed class WindowInfo { public long hwnd; public uint pid; public string title, cls; public bool minimized; }
  public sealed class KeyInfo { public uint vk; public bool up, injected; }
  static readonly List<KeyInfo> events = new List<KeyInfo>();
  static readonly object gate = new object();
  static readonly ManualResetEvent ready = new ManualResetEvent(false);
  static Thread thread; static uint threadId; static IntPtr hook; static HookProc callback;
  public static WindowInfo[] Windows() {
    var rows = new List<WindowInfo>();
    EnumWindows(delegate(IntPtr h,IntPtr p) {
      if (IsWindowVisible(h)) {
        var title = new StringBuilder(512); var cls = new StringBuilder(256); uint pid;
        GetWindowText(h,title,title.Capacity); GetClassName(h,cls,cls.Capacity); GetWindowThreadProcessId(h,out pid);
        rows.Add(new WindowInfo {hwnd=h.ToInt64(),pid=pid,title=title.ToString(),cls=cls.ToString(),minimized=IsIconic(h)});
      } return true;
    },IntPtr.Zero); return rows.ToArray();
  }
  public static void FocusFixture(IntPtr h) {
    Application.DoEvents(); uint pid; uint front=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    uint current=GetCurrentThreadId(); bool joined=front!=0 && front!=current && AttachThreadInput(current,front,true);
    try { ShowWindow(h,9); SetForegroundWindow(h); }
    finally { if(joined) AttachThreadInput(current,front,false); }
  }
  public static void CloseWindow(long h) { PostMessage(new IntPtr(h),0x10,IntPtr.Zero,IntPtr.Zero); }
  public static void Start() {
    thread = new Thread(delegate() {
      threadId=GetCurrentThreadId(); callback=delegate(int code,IntPtr msg,IntPtr data) {
        if (code>=0) { var k=(Kbd)Marshal.PtrToStructure(data,typeof(Kbd));
          lock(gate) { if(events.Count>=128) events.RemoveAt(0); events.Add(new KeyInfo {vk=k.vk,up=(k.flags&128)!=0,injected=(k.flags&16)!=0}); }
        } return CallNextHookEx(hook,code,msg,data);
      };
      hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0); ready.Set();
      if(hook!=IntPtr.Zero) { Application.Run(); UnhookWindowsHookEx(hook); }
    }); thread.IsBackground=true; thread.SetApartmentState(ApartmentState.STA); thread.Start();
    if(!ready.WaitOne(5000) || hook==IntPtr.Zero) throw new Exception("Native keyboard observation unavailable");
  }
  public static void Clear() { lock(gate) events.Clear(); }
  public static KeyInfo[] Keys() { lock(gate) return events.ToArray(); }
  public static void Stop() { if(thread!=null) { PostThreadMessage(threadId,0x12,UIntPtr.Zero,IntPtr.Zero); thread.Join(3000); } }
}
'@
$results = New-Object 'System.Collections.Generic.List[object]'
$worker = $null; $hostProcess = $null; $pack = $null
$protocol = New-Object 'System.Collections.Generic.List[object]'
function Await-Value([scriptblock]$check, [string]$label, [int]$seconds = 12) {
  $limit = [DateTime]::UtcNow.AddSeconds($seconds)
  do { $value = & $check; if ($value) { return $value }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $limit)
  throw "Timed out observing $label"
}
function Record([string]$name,[scriptblock]$body) {
  try { $detail = & $body; $results.Add(@{name=$name;status='passed';detail=$detail}) }
  catch { $status='failed'; if ($_.Exception.Message.StartsWith('NOT_COVERED:')) { $status='not-covered' }
    $results.Add(@{name=$name;status=$status;message=$_.Exception.Message})
    try { Capture ('failure-'+($name -replace '[^a-zA-Z0-9]','-')) } catch {} }
  Write-Output ($results[$results.Count-1] | ConvertTo-Json -Compress -Depth 8)
}
function Capture([string]$name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $image = New-Object Drawing.Bitmap($b.Width,$b.Height)
  $g = [Drawing.Graphics]::FromImage($image)
  try { $g.CopyFromScreen($b.Left,$b.Top,0,0,$image.Size); $image.Save((Join-Path $out ($name+'.png')),[Drawing.Imaging.ImageFormat]::Png) }
  finally { $g.Dispose(); $image.Dispose() }
  [FinishOracle]::Windows() | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out ($name+'-windows.json')) -Encoding UTF8
}
function Read-Worker([int]$seconds) {
  $task = $worker.StandardOutput.ReadLineAsync()
  if (-not $task.Wait($seconds*1000)) { throw 'Worker response timeout' }
  $line = $task.Result; if ($null -eq $line) { throw 'Worker exited before responding' }
  return $line.TrimStart([char]0xFEFF)
}
function Keys([string]$value) {
  $requestId=[guid]::NewGuid().ToString('N')
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{keys=$value} | ConvertTo-Json -Compress)))
  $worker.StandardInput.WriteLine("$requestId`tkeys`t$payload"); $worker.StandardInput.Flush()
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  do {
    $remaining=[Math]::Max(1,[Math]::Ceiling(($deadline-[DateTime]::UtcNow).TotalSeconds))
    $line=Read-Worker ([int]$remaining)
    if($protocol.Count -ge 50) { $protocol.RemoveAt(0) }
    $protocol.Add(@{keys=$value;sentId=$requestId;received=$line})
    $tab=$line.IndexOf([char]9)
    # The production bridge also ignores stdout lines without protocol framing.
  } while($tab -lt 0 -and [DateTime]::UtcNow -lt $deadline)
  if($tab -lt 0) { throw 'Worker did not return a framed response' }
  $parts=$line.Split([char]9)
  if ($parts[0] -ne $requestId) { throw ('Wrong worker response identity: expected '+$requestId+', received '+$parts[0]) }
  $response = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1])) | ConvertFrom-Json
  if (-not $response.ok) { throw $response.error }
}
function Host-State { try { return Get-Content (Join-Path $out 'host/state.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null } }
function Focus-Host {
  $state=Host-State
  $hostProcess.Refresh()
  if($hostProcess.HasExited) { throw 'Test fixture exited during shell preparation' }
  if(-not $state -or $state.pid -ne $hostProcess.Id) { throw 'Fixture window identity changed' }
  [FinishOracle]::FocusFixture([IntPtr][long]$state.hwnd)
  $script:commandSeq++
  @{seq=$commandSeq;kind='focus-main'} | ConvertTo-Json -Compress | Set-Content (Join-Path $out 'host/command.json') -Encoding UTF8
  [void](Await-Value { $s=Host-State; if($s -and $s.commandSeq -eq $commandSeq -and $s.foreground -eq $s.hwnd) { $s } } 'fixture focus')
}
function Assert-Released {
  foreach ($key in @(0x10,0x11,0x12,0x5B,0x5C)) { if (([FinishOracle]::GetAsyncKeyState($key) -band 0x8000) -ne 0) { throw "Modifier still pressed: $key" } }
}
$commandSeq=0; $fatal=$null
try {
  if ($env:OS -ne 'Windows_NT') { throw 'Windows desktop required' }
  if ($Mode -eq 'Keys') {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows/build-host.ps1') -Output (Join-Path $out 'Host.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
    $hostProcess=Start-Process (Join-Path $out 'Host.exe') -ArgumentList ('"'+(Join-Path $out 'host')+'"') -PassThru
    $s=Await-Value { Host-State } 'visible fixture' 30
    if (-not $s.interactive) { throw 'No interactive input desktop' }
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName='powershell.exe'; $start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $root 'a11y/worker.ps1')+'"'
    $start.UseShellExecute=$false; $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true; $start.CreateNoWindow=$true
    $start.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
    $start.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
    $worker=New-Object Diagnostics.Process; $worker.StartInfo=$start; [void]$worker.Start()
    $stderr=$worker.StandardError.ReadToEndAsync()
    if ((Read-Worker 60) -ne 'READY') { throw 'Worker did not signal readiness' }
    [FinishOracle]::Start()
    # Observe native injected events, rather than intercepting or mocking input.
    foreach ($case in @(
      @{text='win+r';down=@(91,82)},@{text='win+d';down=@(91,68)},@{text='win+e';down=@(91,69)},
      @{text='win+tab';down=@(91,9)},@{text='win+shift+s';down=@(91,16,83)},@{text='#r';down=@(91,82)}
    )) {
      Record ('native chord '+$case.text) {
        try {
        Focus-Host; $before=@([FinishOracle]::Windows() | ForEach-Object {$_.hwnd})
        [FinishOracle]::Clear(); Keys $case.text; Start-Sleep -Milliseconds 300
        $events=@([FinishOracle]::Keys() | Where-Object injected)
        $events | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out ('events-'+($case.text -replace '[^a-zA-Z0-9]','-')+'.json')) -Encoding UTF8
        $down=@($events | Where-Object {-not $_.up} | ForEach-Object { if($_.vk -in @(160,161)) {16} else {[int]$_.vk} })
        $up=@($events | Where-Object up | ForEach-Object { if($_.vk -in @(160,161)) {16} else {[int]$_.vk} })
        if (($down -join ',') -ne ($case.down -join ',')) { throw ('Wrong native key-down order: '+($down -join ',')) }
        $expectedUp=@($case.down); [array]::Reverse($expectedUp)
        if (($up -join ',') -ne ($expectedUp -join ',')) { throw ('Wrong native key-up order: '+($up -join ',')) }
        Assert-Released; Capture ('chord-'+($case.text -replace '[^a-zA-Z0-9]','-'))
        return @{events=$events;modifiersReleased=$true}
        } finally {
          if($case.text -eq 'win+d') { Keys 'win+d' }
          elseif($case.text -eq 'win+e') {
            $opened=Await-Value { [FinishOracle]::Windows() | Where-Object {$_.cls -eq 'CabinetWClass' -and $_.hwnd -notin $before} } 'test-created Explorer window'
            foreach($w in $opened) { [FinishOracle]::CloseWindow($w.hwnd) }
          } else { Keys 'esc' }
        }
      }
    }
    Record 'win+r opens Run dialog' {
      Focus-Host; Keys 'win+r'
      $w=Await-Value { [FinishOracle]::Windows() | Where-Object {$_.cls -eq '#32770' -and $_.title -eq 'Run'} } 'Run dialog'
      Capture 'run-dialog'; foreach($window in $w) { [FinishOracle]::CloseWindow($window.hwnd) }; return $w
    }
    Record 'win+d shows desktop and restores fixture' {
      Focus-Host; Keys 'win+d'; [void](Await-Value { (Host-State).minimized } 'fixture minimized')
      Capture 'desktop'; Keys 'win+d'; [void](Await-Value { $s=Host-State; $s -and -not $s.minimized } 'fixture restored'); return 'Fixture minimized then restored'
    }
    Record 'win+e opens File Explorer window' {
      Focus-Host; $before=@([FinishOracle]::Windows() | ForEach-Object {$_.hwnd}); Keys 'win+e'
      $w=Await-Value { [FinishOracle]::Windows() | Where-Object {$_.cls -eq 'CabinetWClass' -and $_.hwnd -notin $before} } 'new Explorer window'
      Capture 'file-explorer'; foreach($window in $w) { [FinishOracle]::CloseWindow($window.hwnd) }; return $w
    }
    Record 'win+tab opens Task View' {
      Focus-Host; $before=@([FinishOracle]::Windows() | ForEach-Object {$_.hwnd}); Keys 'win+tab'
      $w=Await-Value { [FinishOracle]::Windows() | Where-Object {($_.cls -match 'MultitaskingViewFrame|XamlExplorerHostIslandWindow' -or $_.title -eq 'Task View') -and $_.hwnd -notin $before} } 'new Task View window'
      Capture 'task-view'; Keys 'esc'; return $w
    }
    Record 'win+shift+s opens screen clipping overlay' {
      if (-not (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue)) { throw 'NOT_COVERED: Appx/Snipping Tool capability is unavailable; native chord is tested separately.' }
      $tool=Get-AppxPackage -Name '*ScreenSketch*' -ErrorAction SilentlyContinue
      if (-not $tool) { throw 'NOT_COVERED: ScreenSketch/Snipping Tool package is absent on this Windows Server runner; native chord is tested separately.' }
      Focus-Host; Keys 'win+shift+s'
      $w=Await-Value { [FinishOracle]::Windows() | Where-Object {$_.cls -match 'ScreenClipping' -or $_.title -match 'Snipping|Screen snip'} } 'screen clipping overlay'
      Capture 'screen-clipping'; Keys 'esc'; return $w
    }
  } else {
    $exe=[IO.Path]::GetFullPath((Join-Path $root $Executable))
    if (-not (Test-Path $exe)) { throw "Portable EXE missing: $exe" }
    $reportHash=(Get-FileHash $exe -Algorithm SHA256).Hash
    # Keep the PS 5.1 source ASCII; it can load UTF-8 without BOM as ANSI.
    $runCaption='Ajan'+([char]0x0131)+' '+([char]0x00C7)+'al'+([char]0x0131)+([char]0x015F)+'t'+([char]0x0131)+'r'
    $pack=Start-Process $exe -PassThru
    Record 'portable EXE loads the real studio renderer' {
      $window=Await-Value {
        foreach ($w in [FinishOracle]::Windows()) {
          if ($w.title -ne 'Nubbo Agent Studio') { continue }
          $p=Get-Process -Id $w.pid -ErrorAction SilentlyContinue
          if (-not $p -or $p.ProcessName -ne 'Nubbo Agent Studio') { continue }
          $element=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.hwnd)
          $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
          $buttons=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
          $names=@($buttons | ForEach-Object {$_.Current.Name})
          if (@($names | Where-Object {$_.Contains($runCaption)}).Count -gt 0 -and @($names | Where-Object {$_ -match 'Node Ekle'}).Count -gt 0) {
            return @{window=$w;buttons=$names;processPath=$p.Path}
          }
        }
      } 'portable studio toolbar (not merely splash)' 60
      Capture 'portable-studio'; return $window
    }
  }
} catch { $fatal=$_.Exception.Message; Write-Output $fatal }
finally {
  [FinishOracle]::Stop()
  $protocol.ToArray() | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'worker-protocol.json') -Encoding UTF8
  if ($worker) { try {$worker.StandardInput.Close(); if(-not $worker.WaitForExit(3000)) {$worker.Kill()}} catch {}; $worker.Dispose() }
  if ($hostProcess) { Stop-Process -Id $hostProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($pack) {
    # Only test-launched portable processes: never terminate unrelated apps.
    $testTree=@($pack.Id)
    for($i=0;$i -lt 5;$i++) {
      $children=@(Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -in $testTree} | ForEach-Object {$_.ProcessId})
      $testTree=@($testTree+$children | Select-Object -Unique)
    }
    [array]::Reverse($testTree)
    foreach($id in $testTree) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  }
  $failed=@($results | Where-Object {$_.status -eq 'failed'}).Count
  $passed=@($results | Where-Object {$_.status -eq 'passed'}).Count
  $notCovered=@($results | Where-Object {$_.status -eq 'not-covered'}).Count
  @{mode=$Mode;revision=$env:GITHUB_SHA;fatal=$fatal;passed=$passed;failed=$failed;notCovered=$notCovered;exeSHA256=$reportHash;results=@($results.ToArray())} |
    ConvertTo-Json -Depth 12 | Set-Content (Join-Path $out ($Mode.ToLowerInvariant()+'-summary.json')) -Encoding UTF8
}
if ($fatal -or $failed -gt 0 -or $passed -eq 0) { exit 1 }
exit 0
