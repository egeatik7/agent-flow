# Blender penceresini kapatmadan küçültür.
#
# Neden: canlı senaryolar, fikstür penceresinin önde olmasını bekler. Dün gece açık bıraktığım
# Blender önde kalınca akış "Kaynak klasör"ü Blender'ın içinde aradı ve senaryo kaldı. Kapatmak
# yerine küçültülür: içindeki kaydedilmemiş sahne kaybolmasın.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$hedef = Get-Process -Name 'blender' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $hedef) {
  Write-Output 'Blender çalışmıyor (yapılacak bir şey yok)'
  exit 0
}
foreach ($p in $hedef) {
  [void][Win]::ShowWindow($p.MainWindowHandle, 6)   # 6 = SW_MINIMIZE
  Write-Output "küçültüldü: pid $($p.Id) · '$($p.MainWindowTitle)'"
}
Start-Sleep -Milliseconds 400
$onde = (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1)
Write-Output "son durum: Blender pencereleri küçültüldü ($($hedef.Count) adet)"
