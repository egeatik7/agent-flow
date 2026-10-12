# QwenChat kurulum: dosyalari kalici klasore kopyalar, masaustu kisayolu olusturur.
# Kullanim:  powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$dst = Join-Path $env:USERPROFILE 'QwenChat'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

Copy-Item (Join-Path $src 'server.py') $dst -Force
Copy-Item (Join-Path $src 'index.html') $dst -Force
if (Test-Path (Join-Path $src 'icon.ico')) { Copy-Item (Join-Path $src 'icon.ico') $dst -Force }

# pythonw.exe = konsol penceresi acmadan calistirir
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\pythonw.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\pythonw.exe')
)
$pyw = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $pyw) {
  $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
  if ($cmd) { $pyw = $cmd.Source }
}
if (-not $pyw) { throw 'pythonw.exe bulunamadi. Python kurulu mu?' }

# eski calisan ornegi kapat (dosyalar kilitlenmesin)
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*qwen-chat*' -or $_.CommandLine -like '*QwenChat*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
# kopyalamayi kapatma sonrasi yap (kilitli dosya kalmasin)
Copy-Item (Join-Path $src 'server.py') $dst -Force
Copy-Item (Join-Path $src 'index.html') $dst -Force

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Qwen AI.lnk'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = $pyw
$lnk.Arguments = '"' + (Join-Path $dst 'server.py') + '"'
$lnk.WorkingDirectory = $dst
if (Test-Path (Join-Path $dst 'icon.ico')) { $lnk.IconLocation = (Join-Path $dst 'icon.ico') + ',0' }
$lnk.Description = 'Yerel Qwen sohbet arayuzu (gorsel destekli)'
$lnk.WindowStyle = 7
$lnk.Save()

Write-Output "KURULDU"
Write-Output "  klasor  : $dst"
Write-Output "  python  : $pyw"
Write-Output "  kisayol : $lnkPath"

# hemen baslat
Start-Process -FilePath $pyw -ArgumentList ('"' + (Join-Path $dst 'server.py') + '"') -WorkingDirectory $dst
Write-Output "  durum   : baslatildi -> http://127.0.0.1:8765/"
