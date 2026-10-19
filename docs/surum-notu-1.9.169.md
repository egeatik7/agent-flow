# Sürüm notu — 1.9.169 (tek adımda Durdur, HUD bellek kartı, tuval menüsü, döngü listesi)

**Taban:** `b240045` (1.9.168). Node türleri/şemaları değişmedi.

## Ne değişti

1. **`run.stop` tek adım sürerken doğruyu söylüyor** (`tools.ts`): önceden "koşu yok" deyip süren
   tek adımı iptal ediyordu. Artık "Durdurma istendi; süren tek adım iptal edildi" der ve durdurma
   nedenini kullanıcı olarak işaretler.
2. **Koşu bitince HUD bellek kartı temizleniyor** (`main.ts`): kart yalnız koşu sürerken
   yayınlandığı için eski ölçüm ekranda kalıyor ve "az önce ölçüldü" görünüyordu; artık koşu
   sonunda `{kart:null}` gönderilir.
3. **Tuval sağ tık menüsü zoom ile küçülmüyor** (`NodeCanvas.tsx`): menü `scale()` katmanı içinde
   olduğu için %25–50 yakınlaştırmada okunamaz hâle geliyordu; karşı ölçekle sabit boyutta kalır.
4. **Döngü listesi O(n²) değil** (`SidePanel.tsx`): her satır için dolu öğe sırası yeniden
   sayılıyordu (satır başına 4 tarama); dolu konumlar bir kez hesaplanır. Binlerce öğeli listede
   her tuş vuruşu/sürükleme donuyordu.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **198 dosya / 1492 test** yeşil.
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- UI değişiklikleri (menü ölçeği, döngü listesi) kod + tip denetimiyle sınandı; gerçek Electron
  penceresinde görsel ölçüm yapılmadı.
- Bilinçli istisnalar değişmedi: `screen.ps1` simge dx/dy telafisi (şema değişikliği gerekir),
  `zip-library-storage` EPERM flaky testi (kullanıcı kararı: F2 kapalı), `checkpoint-output-watch`
  tek yazıcı kuyruğu (tasarım).
