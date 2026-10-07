# Sürüm notu — 1.9.42

Kullanıcının iki isteği: **(1) hover → emin ol → tıkla yolunu sağlamlaştır**, **(2) yazı kutularına
yazmayı sıfır soruna indir**. Ölçüme dayalı ilerleme; **abartı yok**.

## (1) Hover → emin ol → tıkla: SAĞLAMLAŞTIRILDI ✓
- `moveAt` artık **imlecin gerçekten gittiğini doğrular**: `SetCursorPos` true dönse bile imleç
  hedefte değilse **bir kez daha** denenir; yine olmazsa `INPUT_MOVE_FAILED: Cursor did not reach
  the target point` döner → **sessizce "gidildi" denmez**.
  (Test iskeletlerinde `Get-CursorPoint` yüklü değilse doğrulama atlanır; mevcut harness'ler
  bozulmadı.)
- Zaten yerinde olan korumalar: tıklama anında **gerçek imleç** okunur (3 px tolerans), **hwnd
  damgası** (pencere değiştiyse `INPUT_CLICK_STALE`), örtülme (`INPUT_CLICK_OCCLUDED`), durdurma
  sonrası gecikmiş cevabın tıklama üretmemesi.
- **Eksik (dürüst):** yeni geri-okuma/yeniden-deneme yolunun **kendi testi yok** (harness'ler natif
  API'leri taklit ettiği için o yol atlanıyor). Ölçülmedi.

## (2) Yazı kutularına yazma: ÖLÇÜLDÜ, HENÜZ SIFIR DEĞİL ✗
223 gerçek günlükten ölçülen hatalar:
- **14×** "Odaktaki öğe bir yazı alanı değil (Window); Ctrl+A / Delete gönderilmedi, sadece yazıldı."
- **9×** "Odak bir yazı alanı değil (Pane). Yazı gönderilmedi."
- **5× + 2×** "INPUT_FOCUS_UNRESOLVED; UIA=Pane, native=TkChild, pencere=**Görsel İsimlendirici**".

Yapılan: yazma kapısı **tek kaynağa** alındı (`inputGuardFor`, 6 yeni test) ve **reddin nedeni
ölçülecek hale** getirildi — günlüğe artık `direct / temizle / tiklama / bağ / hedefKaydı` alanları
yazılıyor.

**Bu turda yapılmayan (bilerek):** yazma yolunu "daha çok yazsın" diye gevşetmek. İlk denemem
doğrudan yolu temizleme isteği olmadan da açıyordu; `scripts/test-input-recovery.ps1` bunu
**"forced route cannot erase"** ile yakaladı → geri alındı. Paketin kuralı korunuyor: doğrudan yol
**yalnız açık "mevcut metni temizle" isteğiyle** kullanılır.

**Sıradaki adım:** gerçek bir koşuda günlükteki yeni alanlar hangi kapının kapandığını gösterecek
(`direct=false, temizle=true, tiklama=null, bag=yok` gibi) → düzeltme **o kanıta** göre yapılacak.

## Doğrulanan
- `typecheck` ✓ · **Vitest 44 dosya / 288 test** ✓ (yeni `tests/input-guard.test.ts`) ·
  `test:keys/input/recovery/stability/targeting` ✓ · `build:electron` ✓ ·
  `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs` → **63 pass** ✓ ·
  **Windows PowerShell 5.1'de 9 harness hepsi PASS** ✓ · `pack:win` ✓.

## Doğrulanmayan
- **Canlı masaüstü/LLM testi yapılmadı**: hover→tıkla akışının gerçek uygulamada çalışması,
  gerçek Tk alanına yazma ve yeni teşhis alanlarının gerçek koşuda okunması **ölçülmedi**.
- **PowerShell 7 (`pwsh.exe`) kurulu değil → atlandı.**