# Sürüm notu — 1.9.41

**Masaüstü kısayoluna tıklama engeli kaldırıldı.** Kaynak: kullanıcının gerçek 1.9.40 günlüğü
(`logs\1.9.40\calistirma-2026-10-07T22-06-18.txt`).

## Ölçülen sorun (kullanıcının günlüğünden)
Görev "Open blender 5.2" idi; **model doğru davrandı** — önce `move` ile kısayolun üstüne geldi,
sonra `double` gönderdi — ama **her çift tıklama reddedildi**:
`INPUT_WINDOW_NOT_ACTIVE: Target window did not take foreground focus` (01:06:45, 01:07:26,
01:07:39, 01:07:53 → 4 kez), ardından 25 turlük sınırda durdu.

**Kök neden:** masaüstü kısayolunun hedef penceresi **masaüstüdür** (`Progman`/`WorkerW`) ve
Windows'ta masaüstü penceresi `SetForegroundWindow` ile **önplana alınamaz**. Worker "hedef
önplanda mı" diye şart koştuğu için kontrol **hiçbir zaman** geçemiyordu → masaüstü kısayoluna
tıklamak imkânsızdı.

## Düzeltme
- `common.ps1`: `XpNative.GetClassName` + **`Test-ShellWindow`** (Progman, WorkerW, Shell_TrayWnd,
  Shell_SecondaryTrayWnd, SHELLDLL_DefView, SysListView32).
- `worker.ps1` **`Get-BoundWindow`**: önplan şartı **yalnız aktivasyon istenen yolda** ve yalnız
  hedef **kabuk penceresiyse** aranmaz; diğer bütün durumlarda **eski sıkı kontrol aynen** durur.
- `worker.ps1` **`Get-InputTarget`**: aynı tolerans; **yardımcı yüklenmemişse kabuk SAYILMAZ**
  (`Get-Command` koruması) → test iskeletine bağımlılık yok, sıkı davranış korunur.
- Yerleşim (`INPUT_LAYOUT_CHANGED`) kontrolü **eski hâline** döndü (gereksiz tolerans kaldırıldı).

## Doğrulanan
- `typecheck` ✓ · **Vitest 282 test** ✓ · `test:keys/input/recovery/stability/targeting` ✓ ·
  `build:electron` ✓ · `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs`
  → **63 pass** ✓ · `pack:win` ✓.
- **Windows PowerShell 5.1'de 9 harness hepsi PASS** ✓; yeni
  **`scripts/test-shell-window-click.ps1`** gerçek masaüstünde **2 gerçek kabuk penceresini**
  doğruluyor ve **masaüstüne girdi göndermiyor** ✓.
- Kendi yol açtığım regresyon da kapatıldı: `test-input-recovery.ps1` kırılmıştı çünkü yeni
  yardımcı test iskeletinde yüklü değildi → üretim kodu artık **yardımcı yoksa sıkı** davranıyor.

## Doğrulanmayan (dürüst not)
- **Canlı Blender açma denemesi yapılmadı**: gerçek masaüstü kısayoluna çift tıklamanın Blender'ı
  açtığı **ölçülmedi**. Yeni harness kabuk tespitini gerçek pencerelerle doğrular, ama
  **tıklamanın kendisi** (girdi enjeksiyonu) sınanmadı.
- **PowerShell 7 (`pwsh.exe`) bu makinede kurulu değil → atlandı.**