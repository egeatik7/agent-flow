# Sürüm notu — 1.9.168 (Durdur her zaman çalışır, hafıza kanıt ister, checkpoint kesintisi görünür)

**Taban:** `59b18da` (1.9.167). Node türleri/şemaları değişmedi.

## Ne değişti

1. **Durdur kısayolu uygulama ömrü boyunca kayıtlı** (`main.ts`): eskiden yalnız koşu sırasında
   kaydediliyordu. Tek eylem (`act.*`) uygulamayı gizlediğinde Ctrl+Shift+Q **hiç çalışmıyordu**,
   yalnız zaman aşımı kalıyordu. Artık koşu ya da tek adım sürerken her durumda durdurur; kayıt
   başarısızsa günlüğe açık uyarı yazılır.
2. **Hafızaya yalnız kanıtlı hedef yazılıyor** (`agent.ts`): Yazı Yaz yolu, alanın geri okunması
   yazılanla eşleşmiyorsa (ya da değer okunamıyorsa) hafıza kaydı yazmıyor; kullanıcının açıkça
   seçtiği `locator` varsa kanıt sayılıyor. Yanlış çözülen alan sonraki turlarda kendini
   pekiştirmiyor (§17).
3. **Checkpoint kesintisi panelde görünüyor** (`checkpoints.ts`): yazım EPERM/ENOSPC ile kesilirse
   `.resume-unreliable.json` bırakılır; `detail()` bu kayda "buradan devam ederken öğeler yeniden
   çalışabilir" uyarısı ekler. Yeni koşu başlarken işaret temizlenir.
4. **Ortak yanıt hatası merge'i kilitlemiyor** (`App.tsx`): merge işleyicisi fırlatırsa hata main'e
   hemen bildirilir; 20 sn bekleyip "uygulanmış olabilir" denmez.
5. **Yükleme hataları sessiz değil** (`main.ts`): `loadURL`/`loadFile` reddi günlüğe ve önyükleme
   satırına yazılır (boş pencere "Hazır" görünmüyor).
6. **Viewer soket sınırı jetondan SONRA** (`viewer-server.ts`): 12 sınırı yalnız kimliğini
   doğrulamış izleyicilere uygulanır; kimliksiz soketler gerçek tablet izleyicisini kapıdan çeviremez
   (bağlantı sayısı 64 ile sınırlı).

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **198 dosya / 1492 test** yeşil. Yeni: `tests/checkpoint-unreliable.test.ts`
  (işaret panelde görünür, yeni koşuda temizlenir).
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı** (stability harness'i, kısayol kancası koşudan çıkınca geçersiz kalan
  temizlik senaryosunu `hideHudSoon` üzerinden yeniden kuruyor).
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- Canlı masaüstü koşusu yapılmadı; kısayol ve hafıza kapıları kod + mevcut paketlerle sınandı.
- Kalan bilinçli istisnalar: `screen.ps1` simge dx/dy telafisi (locator şemasına alan eklemek
  gerekir; §13 şema değişikliği yasağı), `zip-library-storage` EPERM flaky testi (kullanıcı kararı:
  F2 kapalı), `checkpoint-output-watch` dolu klasör gezmesinin kuyruğu (tasarım: tek yazıcı).
