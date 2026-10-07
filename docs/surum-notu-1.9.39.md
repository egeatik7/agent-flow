# Sürüm notu — 1.9.39

**Doğrudan yazma + gerçek native fare API düzeltmesi.** Kaynak: kullanıcının
`Nubbo_Direct_Input_And_Mouse_Fix` paketi (taban `aac227c` = 1.9.38; `git apply --check` temiz).

## Kritik hata düzeltmesi (1.9.33'ten beri vardı)
- **`moveAt` var olmayan `XpWin.SetCursorPos`'u çağırıyordu.** Bu, "Fareyi Oynat"ın **canlıda hata
  vermesi** demekti; 1.9.33 testleri yalnız kaynak metnini kontrol ettiği için yakalayamamıştı.
  Artık `common.ps1` içinde gerçekten var olan **`XpNative.SetCursorPos`** kullanılıyor ve başarısızlık
  `INPUT_MOVE_FAILED` olarak döner. Paketin regresyon kanıtı: bu test **temel kodda kırılıyor**.

## Yazma davranışı
- Alan tıklamayla seçildikten sonra, "mevcut metni temizle" açıksa: **Ctrl+A → Delete → istenen metni yaz.**
  Alan **boşken** veya içinde **ilgisiz başka bir dosyanın adı** varken de çalışır.
- Yazma izni için **eski içeriği OCR/kopya ile karşılaştırma yolu kaldırıldı** (`electron/custom-input.ts`
  ve testi silindi). **OCR hedef bulmak için kullanılmaya devam ediyor**; kaldırılan şey yazma iznini
  alanın eski içeriğine bağlamaktı.
- **TkChild/Pane olması veya 1×1/eksik caret tek başına yazmayı engellemiyor.**
- Korunanlar: aktif pencere/HWND/PID/yerleşim ve **native klavye odağı** ilişkisi; bilinen düğme,
  devre dışı veya **salt okunur** alan **silinmez**; **geçerli tıklanmış nokta yoksa** ya da **ekleme
  (insert) modu** seçilmişse zorla temizleme yolu kullanılmaz.
- Görsel inisiyatifte **önce move → güncel kare → click_current** sözleşmesi korunuyor; hareket
  tıklamaya dönüşmüyor.

## Doğrulanan
- `typecheck` ✓ · **Vitest 282 test** ✓ · `test:keys/input/recovery/stability/targeting` ✓ ·
  `build:electron` ✓ · `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs`
  → **53 pass** ✓ · **Windows PowerShell 5.1**'de 6 harness **hepsi PASS** ✓ (worker, key-input 129,
  input-recovery **68 checks** "direct replacement" dahil, visual-input, hover-worker, cursor-frame) ·
  `git diff --check` ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **PowerShell 7 (`pwsh.exe`) bu makinede kurulu değil → atlandı.** Paket onu Linux'ta 7.4.12 ile
  sınamış; burada **Windows PowerShell 5.1** ile sınandı.
- **Canlı masaüstü testi yapılmadı**: gerçek Tk alanına Ctrl+A → Delete → yazma, boş/ilgisiz içerikli
  alan, insert modu ve salt okunur alan reddi **ölçülmedi**. PowerShell kontrolleri **gerçek üretim
  gövdelerini** çalıştırır ama klavye/fare API'leri **taklittir**.