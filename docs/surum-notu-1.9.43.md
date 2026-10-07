# Sürüm notu — 1.9.43

**Masaüstü kısayoluna tıklama: kök neden bulundu.** Kanıt: kullanıcının **1.9.42 gerçek koşu
günlüğü** — aynı hata **5 kez**: `INPUT_WINDOW_NOT_ACTIVE: Target window did not take foreground
focus` (01:24:50, 01:25:06, 01:25:21, 01:25:52, 01:26:05 → durduruldu).

## Kök neden: 1.9.41'deki düzeltmem kendi kapısının arkasında kilitli kaldı
`Get-BoundWindow`'daki kabuk toleransı **yanlışlıkla `$activate` koşuluna** bağlanmıştı. **Tıklama
yolu bu fonksiyonu `$activate = $false` ile çağırıyor** (`clickAt`, `clickCurrentAt`, `moveAt` →
`Get-BoundWindow $P.target $false`) → tolerans **hiç devreye girmedi** → masaüstü kısayoluna tıklama
yine engellendi.

## Düzeltme
- Tolerans artık **aktivasyondan bağımsız**: hedef pencere kabuk penceresiyse (`Progman`, `WorkerW`,
  `Shell_TrayWnd`, `Shell_SecondaryTrayWnd`, …) önplan şartı aranmaz; **diğer bütün pencerelerde
  sıkı kontrol aynen durur**; yardımcı yüklenmemişse kabuk **sayılmaz**.
- **Teşhis**: `INPUT_WINDOW_NOT_ACTIVE` artık hedef/önplan/nokta pencerelerini **hex** yazar
  (`[hedef=0x… onplan=0x… nokta=0x…]`).
- **Regresyon nöbetçisi**: `scripts/test-shell-window-click.ps1` toleransın **aktivasyona
  bağlanmasını yasaklıyor**; kontroller **yorumlara değil koda** bakıyor.

## Doğrulanan
- `typecheck` ✓ · Vitest 44 dosya / **288 test** ✓ · `build:electron` ✓ ·
  `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs` → **63 pass** ✓ ·
  **Windows PowerShell 5.1'de 9 harness hepsi PASS** ✓ · `pack:win` ✓ ·
  **pakete giren** `resources/a11y/worker.ps1` içinde aktivasyondan bağımsız tolerans doğrulandı ✓.

## Doğrulanmayan (dürüst)
- **Bu düzeltmenin gerçek akışta çalıştığı HENÜZ ÖLÇÜLMEDİ.** Kanıt, 1.9.42 günlüğündeki 5 hatanın
  kök nedenidir; doğrulama **yeni bir gerçek koşuyla** yapılacak. Bu kez "oldu" demeden önce
  günlüğü göreceğim.
- Yazma (Tk/Pane) tarafı bu turda **ele alınmadı** (akış tıklamada öldüğü için ölçüm boş çıktı).
- **PowerShell 7 (`pwsh.exe`) kurulu değil → atlandı.**