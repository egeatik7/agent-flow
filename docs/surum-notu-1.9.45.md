# Sürüm notu — 1.9.45

**Tıklama zinciri tamamlandı ve kısayol bekçisi düzeltildi.** Kaynak: kullanıcının 1.9.44 günlüğü.

## Kanıt (1.9.44 gerçek koşu)
```
01:46:48  Fare oynatıldı @806,451 (tıklama yok)
01:47:12  Modelin seçtiği tıklama yürütüldü: çift tıkla (%54,%42)
01:47:43  SUCCESS Tıklandı: uygulama öğesi "User Perspective" @140,148   ← BLENDER AÇILDI
01:47:49  ERROR  INPUT_WINDOW_NOT_ACTIVE: Another program is in front; the shortcut was not sent
```
Yani **masaüstü kısayolu → uygulama açma çalışıyor**; kalan hata **tıklama değil**, worker'daki
**`Assert-KeyWindowActive`** (Tuş Gönder / kısayol bekçisi).

## Değişen
1. **Kısayol bekçisi kabuk toleransı**: `Assert-KeyWindowActive` artık hedef **masaüstü/görev çubuğu**
   (`Progman`, `WorkerW`, `Shell_TrayWnd`, …) ise kısayolu **reddetmiyor** — bu pencereler önplana
   alınamadığı için **hiçbir tuş gönderilemiyordu**. Diğer bütün pencerelerde koruma **aynen** durur.
   Reddin tanısı artık hex: `[hedef=0x… onplan=0x… hedefPid=…]`.
2. **Tıklamaya pencere damgası (hwnd) artık HİÇ takılmıyor**: eski modda imleç kaydının damgası
   tıklamaya ekleniyor ve kayıt başka bir pencereye aitse tıklama **örtülü sayılıp reddediliyordu**
   (ölçüldü: tıklama hiç gitmiyordu). Modelin kendi tıklaması olduğu gibi gönderilir; damga yalnız
   `click_current` yolunda kullanılır.
3. **Sekiz eski-mod sözleşme testi** yeni sözleşmeye çevrildi (silinmedi, **gevşetilmedi**):
   *"seçilen tıklama aynen uygulanır · harekete çevrilmez · hover-only + finished kabul edilir ama
   tıklama uydurulmaz"*. Artık yapısal olarak imkânsız hâle gelen **bir** test (damga devralma)
   gerekçesiyle kaldırıldı; aynı akış iki testte kapsanıyor.

## Doğrulanan (hepsi YEŞİL)
- `typecheck` ✓ · **Vitest 44 dosya / 288 test** ✓ · **`test:keys/input/recovery/stability/targeting`** ✓ ✓
  (`recovery`: **38 pass / 0 fail**) · `build:electron` ✓ ·
  `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs` → 38 + 21 ✓ ·
  **Windows PowerShell 5.1'de 9 harness hepsi PASS** ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst)
- **Bu sürümün gerçek akışta çalıştığı HENÜZ ÖLÇÜLMEDİ**; doğrulama yeni bir koşuyla yapılacak.
- Yazma (Tk/Pane) tarafı hâlâ ele alınmadı. **PowerShell 7 kurulu değil → atlandı.**