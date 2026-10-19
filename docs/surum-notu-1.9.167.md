# Sürüm notu — 1.9.167 (sayaç dürüstlüğü, Bitir ekleme koruması, işaretçi doğrulaması)

**Taban:** `a0e2fc7` (1.9.166). Node türleri/şemaları değişmedi.

## Ne değişti

1. **`run.state` sayaç dilini düzeltiyor** (`tools.ts`): "Gözlenen adım olayları" denir; bir öğe
   hatası hem adım hem kutu için `error` olayı üretebildiği için "2 hata" ile resmî "1 hatalı öğe"
   çelişmiyordu. Resmî sonuç satırı öğe/tur sayısını ayrı söyler.
2. **"Bitir" araya eklenemiyor** (`graph-ops.ts`, `App.tsx`): çıkışsız bir node araya girerse
   aşağıdaki adımlar sessizce erişilemez kalıyordu. Artık ekleme yapılmaz, kullanıcıya "Bitir'i
   akışın sonuna ekle" uyarısı verilir; mevcut bağlantılar korunur.
3. **Yap "Süre sınırı" alanı taslak değerle yazılıyor** (`SidePanel.tsx`): her tuş vuruşunda
   10–900'e kırpıldığı için "120" yazmak "900" kaydediyordu; sınır artık odaktan çıkınca/Enter'da
   uygulanıyor.
4. **Aday listesi kırpması tıkla/yaz promptunda da görünüyor** (`openrouter.ts`): 400'lük sınır
   aşıldığında model "listede yok"u "ekranda yok" sanmıyor (koşul promptundaki `PARTIAL` notu artık
   her yolda).
5. **Tanılama kanıtı 1000 istek tutuyor** (`send-log.ts`): 200 klasör yoğun saatte ~1,8 saate denk
   gelip saatlerce süren koşunun erken kanıtını siliyordu; 7 gün yaş sınırı aynı.
6. **İşaretçi hedefe gerçekten vardı mı?** (`screen.ps1`): `SetCursorPos` sonucu ve ClipCursor/sanal
   masaüstü kırpması artık doğrulanıyor; imleç istenen noktaya ulaşamıyorsa (bir yeniden denemeden
   sonra) tıklama gönderilmiyor ve `INPUT_CLICK_STALE` ile açık hata veriliyor. Eski hâl kırpılmış
   noktaya tıklayıp `ok:true` dönüyordu.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **197 dosya / 1490 test** yeşil. Yeni: `tests/canvas-session-drafts.test.ts`
  (tek kayıt + 20 sınır), `tests/graph-ops-end-insert.test.ts` (Bitir araya eklenmez, Tıkla eklenir
  ve zincir korunur).
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- PowerShell: `test-screen`, `test-scan-frame`, `test-visual-crop-geometry`, `test-worker` **geçti**.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Canlı masaüstü koşusu yapılmadı.** İşaretçi doğrulaması koda ve mevcut harness'lere dayanıyor;
  ClipCursor'lu gerçek bir oyun/VM penceresinde sınanmadı.
- Kalanlar: tek eylem sürerken Durdur kısayolunun kayıtlı olmaması (uygulama gizliyken), yazı
  yolunda doğrulanmamış hedefin hafızaya yazılması, checkpoint'in "bayat devam" işareti,
  `screen.ps1` simge dx/dy telafisi, `zip-library-storage` EPERM flaky testi (kullanıcı kararı: F2
  kapalı), `send-log` kanıt boyutu.
