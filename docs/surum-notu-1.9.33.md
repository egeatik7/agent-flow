# Sürüm notu — 1.9.33

**Fareyi oynatma yetkisi (tıklamadan konumlanma).** Kullanıcının isteği: İnisiyatif ajanı bazen
tıklayacağı yeri net seçemiyor, yanlış yere tıklayıp "correction" ile arıyordu. Artık **önce fareyi
oynatabilir** (tıklamadan), **emin olunca bulunduğu yerden tıklayabilir**. Aynı yetenek tıkla
node'una **"Fareyi Oynat"** modu olarak eklendi.

## Değişen (dört katman, birbiriyle uyumlu)
1. **Worker** (`a11y/worker.ps1`): yeni `moveAt` aksiyonu — yalnız `SetCursorPos` ile imleci taşır,
   **tıklama göndermez**; örtülme kontrolü `clickAt` ile aynıdır (görünmeyen noktaya "gidildi"
   denmesin).
2. **Köprü** (`electron/a11y-bridge.ts`): `moveMouse(x, y, target?)`.
3. **Tıkla node'u**: `ClickMode` artık `'left' | 'double' | 'right' | 'move'`; arayüzdeki mod
   kutusunda **"Fareyi Oynat"** seçeneği var (tek/çift/sağ tık korunuyor). Bu modda hedef bulunur,
   **tıklanmaz**; imleç taşınır ve konum hatırlanır. Kayıtlı yol adımları da `move` taşıyabilir.
4. **İnisiyatif (GUI modeli)**: yeni `move(x,y)` eylemi ve **`click_current()`** (fare neredeyse
   **oradan** tıkla). `parseTars`: `move(...)`, `mouse_move(...)`, `hover(...)`, `click_current()`,
   `click_here()` ve **koordinatsız `click()`** artık "oradan tıkla" demektir. Varsayılan promptlar
   (TARS/İnisiyatif) bu iki komutu öğretir; **kayıtlı özel promptlar değiştirilmez**.

## Güvenceler (uydurma yok)
- `move` koordinatsız gelirse **imleç oynatılmaz**, açık uyarı yazılır (merkeze taşımak "hedefe
  gittim" demek olurdu).
- `click_current()` için **fare konumu bilinmiyorsa TIKLAMA GÖNDERİLMEZ**; "önce fareyi oynat"
  uyarısı yazılır (CLAUDE.md §6: "bir yere tıkla, belki olur" yasak).
- Mevcut `click(start_box=…)`, çift/sağ tık, sürükleme, yazma ve kaydırma davranışı **değişmedi**.

## Doğrulanan
- `typecheck` ✓ · Vitest **259 test** ✓ (yeni `tests/mouse-move.test.ts`, 9 test) · beş Node paketi ✓ ·
  `a11y/worker.ps1` ve `common.ps1` **PowerShell ayrıştırma** kontrolü ✓ · `build:electron` ✓ ·
  `pack:win` ✓.

## Dürüst notlar
- Bu değişiklik **motor dosyalarına** dokunur (`a11y/worker.ps1`, `electron/agent.ts`); CLAUDE.md §18
  varsayılan olarak bunu yasaklar. **Kullanıcı açıkça "özel kod yaz" dediği için** yapıldı.
- **Canlı Windows denenmedi**: gerçek fare hareketi, gerçek bir uygulamada "önce oynat sonra oradan
  tıkla" akışı ve Tk/Blender alanlarında hover davranışı ölçülmedi. Testler mantığı ve kaynak
  sözleşmelerini sabitler; gerçek masaüstü kanıtı değildir.