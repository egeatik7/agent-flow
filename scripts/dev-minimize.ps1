# Bir pencereyi başlık parçasına göre küçültür (kapatmaz).
#
# Döngüde ölçülen kural: canlı senaryo, fikstür penceresinin ÖNDE olmasını bekler ve arka plandaki
# bir süreç ön planı başka bir pencereden ALAMAZ. Test örneği (uygulama) açılırken ön planı alır;
# küçültüldüğünde ön plan serbest kalır ve fikstür kendini öne alabilir. Bu yüzden senaryodan önce
# uygulama penceresi küçültülür. Kapatmak yerine küçültülür: açık akış ve oturum kaybolmasın.
param([string]$Title = 'test profili')

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Min {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
}
"@

$hedef = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" }
if (-not $hedef) {
  Write-Output "küçültülecek pencere yok («$Title»)"
  exit 0
}
foreach ($p in $hedef) {
  [void][Min]::ShowWindow($p.MainWindowHandle, 6)   # 6 = SW_MINIMIZE
  Write-Output "küçültüldü: pid $($p.Id) · «$($p.MainWindowTitle)»"
}
Start-Sleep -Milliseconds 400
$h = [Min]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 300
[void][Min]::GetWindowText($h, $sb, 300)
Write-Output "şimdi önde: hwnd $h · «$($sb.ToString())»"
