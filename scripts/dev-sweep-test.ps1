# Damgası doğrulanmış test örneklerini listeler: "pid|ad|ebeveynYolu|başlık" satırları.
#
# Kapatma kararını çağıran verir (JS tarafı): başlık "TEST · " ile başlamalı VE süreç ya
# Nubbo Agent Studio.exe olmalı ya da ebeveyni Nubbo-test.exe (bizim kopya) olmalı.
# Sahibinin gerçek uygulamasının başlığında bu damga yoktur.
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -like '*test profili*' } |
  ForEach-Object {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
    $par = $null
    if ($p) { $par = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue }
    $ad = if ($p) { $p.Name } else { '' }
    $yol = if ($par) { $par.ExecutablePath } else { '' }
    "$($_.Id)|$ad|$yol|$($_.MainWindowTitle)"
  }
