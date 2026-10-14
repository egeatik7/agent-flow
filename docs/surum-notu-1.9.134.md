# Sürüm notu — 1.9.134

**Taban:** `2211cc5` (1.9.133). Kaynak: `Nubbo-OCR-ID-Teshis.patch`.

Seçim kararı değişmedi. Modelin döndürdüğü numara, listedeki aday ve ekrandaki asıl öğe aynı istek klasörüne yazılır.

## Ne değişti

- Her hedef seçimi isteği `ocr-esleme.json` bırakır: ekrandaki öğeler, aday listesi, hangisinin modele gittiği, görüntünün gidip gitmediği.
- Cevap `id-cozumleme.json` bırakır: dönen numara, modelin yazdığı metin, metin çelişkisi, kabul edilen aday ya da rozet, reddin nedeni.
- Günlük satırı `OCR-KANIT` klasör yolunu söyler.
- Seçim yine eskisi gibi kalır. Çelişen metin tıklama üretmez.

## Ölçüm

- `git apply --check` geçti, `--force` kullanılmadı.
- `tests/ocr-diagnostics.test.ts` geçti: 185 numarası “View Marker Playback v” iken model “User Perspective” deyince seçim `null`, kanıt dosyaları duruyor.
- `tests/badge-id-resolution.test.ts` içindeki 2 test bu yamadan önce de kırmızıydı.
