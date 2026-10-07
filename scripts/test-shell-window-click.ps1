# Masaüstü kısayoluna tıklamayı engelleyen önplan şartının kabuk (masaüstü/görev çubuğu)
# pencerelerinde ARANMADIĞINI sınar. Gerçek üretim gövdeleri kullanılır; masaüstüne GİRDİ GÖNDERİLMEZ.
#
# Ölçülen sorun (1.9.40 gerçek profil günlüğü): model önce move, sonra double gönderiyordu ve her
# çift tıklama "INPUT_WINDOW_NOT_ACTIVE: Target window did not take foreground focus" ile
# reddediliyordu; masaüstü penceresi SetForegroundWindow ile önplana alınamadığı için kontrol
# hiçbir zaman geçemiyordu.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes | Out-Null

$tokens = $null; $errors = $null
$workerAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }

# 1) Üretimden Test-ShellWindow fonksiyonu + XpNative bildirimi
$commonTokens = $null; $commonErrors = $null
$commonAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/common.ps1'), [ref]$commonTokens, [ref]$commonErrors)
if ($commonErrors.Count) { throw ($commonErrors | Out-String) }
$shellFn = $commonAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-ShellWindow' }, $true)
if (-not $shellFn) { throw 'Test-ShellWindow üretimde yok' }
$nativeSrc = $commonAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class XpNative \{' }, $true) | Select-Object -First 1
if (-not $nativeSrc) { throw 'XpNative sınıfı bulunamadı' }
if ($nativeSrc.Value -notmatch 'GetClassName') { throw 'XpNative.GetClassName bildirimi yok' }
Add-Type -TypeDefinition $nativeSrc.Value
Invoke-Expression $shellFn.Extent.Text

# 2) GERÇEK masaüstü/kabuk penceresi kabuk sayılmalı (UIA'dan gerçek hwnd okunur)
$sinandi = 0
foreach ($c in [System.Windows.Automation.AutomationElement]::RootElement.FindAll('Children', [System.Windows.Automation.Condition]::TrueCondition)) {
  try {
    $h = [IntPtr]$c.Current.NativeWindowHandle
    if ($h -eq [IntPtr]::Zero) { continue }
    $sb = New-Object System.Text.StringBuilder 256
    [void][XpNative]::GetClassName($h, $sb, 256)
    if (@('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') -contains $sb.ToString()) {
      $sinandi++
      if (-not (Test-ShellWindow $h)) { throw ("Kabuk penceresi tespit edilemedi: " + $sb.ToString()) }
    }
  } catch { }
}
if ($sinandi -eq 0) { throw 'Gerçek masaüstü/kabuk penceresi bulunamadı (masaüstü erişilebilir değil?)' }

# 3) Yanlış pozitif olmasın: sıfır ve rastgele tanıtıcı kabuk SAYILMAMALI
if (Test-ShellWindow ([IntPtr]::Zero)) { throw 'Sıfır tanıtıcı kabuk sayıldı' }
if (Test-ShellWindow ([IntPtr]12345)) { throw 'Rastgele tanıtıcı kabuk sayıldı' }

# 4) Üretim sözleşmesi: tolerans yalnız AKTİVASYON yolunda ve yardımcı yoksa SIKI davranış
$src = Get-Content -Raw (Join-Path $PSScriptRoot '../a11y/worker.ps1')
# Yorumları ayıkla: sözleşme KODA bakmalı, geçmişi anlatan yoruma değil.
$kodSatirlari = @(Get-Content (Join-Path $PSScriptRoot '../a11y/worker.ps1') | Where-Object { $_.Trim() -notlike '#*' })
$kod = $kodSatirlari -join "`n"
# 4a) eski (toleranssız) biçim kalmamalı
$eski = ([regex]::Matches($kod, [regex]::Escape('if ([XpWin]::GetForegroundWindow() -ne $h) { throw'))).Count
if ($eski -ne 0) { throw "Eski (toleranssız) önplan kontrolü kaldı: $eski" }
# 4b) kabuk toleransı iki yerde de olmalı
$tolerans = ([regex]::Matches($kod, [regex]::Escape('Test-ShellWindow $h'))).Count
if ($tolerans -lt 2) { throw "Kabuk toleransı eksik (bulunan: $tolerans, beklenen en az 2)" }
# 4c) her çağrı Get-Command ile korunmalı: yardımcı yüklenmemişse kabuk SAYILMAZ (sıkı davranış)
$koruma = ([regex]::Matches($kod, [regex]::Escape("Get-Command Test-ShellWindow -ErrorAction SilentlyContinue"))).Count
if ($koruma -lt 2) { throw "Test-ShellWindow çağrıları korumasız (bulunan: $koruma, beklenen en az 2)" }
# 4d) Tolerans AKTİVASYONDAN BAĞIMSIZ olmalı. 1.9.41'de yanlışlıkla `$activate` koşuluna
# bağlanmıştı; tıklama yolu bu fonksiyonu $activate=$false ile çağırdığı için masaüstü
# kısayoluna tıklama YİNE engellendi (ölçüldü: 1.9.42 günlüğü, 5× INPUT_WINDOW_NOT_ACTIVE).
$yanlis = ([regex]::Matches($kod, [regex]::Escape('$activate -and (Get-Command Test-ShellWindow'))).Count
if ($yanlis -ne 0) { throw "Tolerans yine aktivasyon kosuluna bagli (bulunan: $yanlis); tikLAMA yolu bu yuzden engellenir" }
$bagimsiz = ([regex]::Matches($kod, [regex]::Escape('if ((Get-Command Test-ShellWindow -ErrorAction SilentlyContinue) -and (Test-ShellWindow $h))'))).Count
if ($bagimsiz -lt 1) { throw "Aktivasyondan bağımsız tolerans yok (bulunan: $bagimsiz)" }
# 4e) Reddin tanısı olmalı: hangi pencere beklendi, hangisi önplanda
if ($kod -notmatch [regex]::Escape("' onplan=0x'")) { throw 'Red mesajında pencere tanısı yok' }

Write-Output "PASS: masaüstü kısayolu tıklaması artık engellenmiyor ($sinandi gerçek kabuk penceresi doğrulandı, $tolerans toleranslı çağrı, $koruma korumalı, $eski eski kontrol, $yanlis aktivasyona bağlı kontrol, $bagimsiz bağımsız tolerans; masaüstüne girdi gönderilmedi)"
