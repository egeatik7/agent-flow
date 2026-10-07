# Bir pencereyi öne alır ve etkinleştirir; ayrıca şu an önde olan pencereyi söyler.
#
# Neden gerekli: canlı senaryolar fikstür penceresinin ÖNDE olmasını bekler. Döngüyü yürüten ajanın
# kendi arayüzü önde kaldığında senaryo hedefi yanlış pencerede arar ve haklı olarak bulamaz.
# Not: parametre adı `TargetPid`; `Pid` PowerShell'de salt-okunur bir değişkendir.
param(
  [int]$TargetPid = 0,
  [string]$Title = '',
  [switch]$Show
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

function Anlat([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return 'hwnd 0' }
  $sb = New-Object System.Text.StringBuilder 300
  [void][Fg]::GetWindowText($h, $sb, 300)
  $wpid = [uint32]0
  [void][Fg]::GetWindowThreadProcessId($h, [ref]$wpid)
  $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  $ad = if ($p) { $p.ProcessName } else { '?' }
  return ("hwnd $h · pid $wpid · $ad · `"$($sb.ToString())`"")
}

if ($Show) {
  Write-Output ("önde: " + (Anlat ([Fg]::GetForegroundWindow())))
  exit 0
}

$adaylar = @()
if ($TargetPid -gt 0) {
  $p = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne 0) { $adaylar += $p }
}
if ($Title) {
  $adaylar += (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" })
}
if (-not $adaylar -or $adaylar.Count -eq 0) {
  Write-Output 'hedef pencere bulunamadı'
  exit 1
}
foreach ($p in $adaylar) {
  [void][Fg]::ShowWindow($p.MainWindowHandle, 9)   # 9 = SW_RESTORE
  [void][Fg]::BringWindowToTop($p.MainWindowHandle)
  [void][Fg]::SetForegroundWindow($p.MainWindowHandle)
  Start-Sleep -Milliseconds 350
  $simdi = [Fg]::GetForegroundWindow()
  Write-Output ("hedef: pid $($p.Id) · `"$($p.MainWindowTitle)`" · önde: " + (Anlat $simdi) + " · TUTTU: $($simdi -eq $p.MainWindowHandle)")
}
