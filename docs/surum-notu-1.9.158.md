# Sürüm notu — 1.9.158

**Taban:** `707eaac` (1.9.157).

## Ne değişti

- **Windows kilidi için sınırlı yeniden deneme.** Kütüphane dosyası yazılırken yeniden adlandırma `EPERM`/`EBUSY`/`EACCES` ile geri dönerse (yalnız Windows), en fazla 12 deneme yapılır (toplam ~3 sn). Sonunda hâlâ başarısızsa hata bildirilir; kayıt yapılmaz, orijinal dosya korunur. (`electron/zip-library-storage.ts`, `renameRetrying`.)
- Test: `tests/zip-rename-retry.test.ts` (4).

## Bilinen (açık)

- Kilidin kaynağı dış bir süreç (büyük olasılıkla Windows Defender gerçek zamanlı tarama) ve bazen 25 saniyeden uzun sürüyor. Yeniden deneme bunu tamamen çözmüyor; zip testlerinde ara sıra (10 koşuda 2 kez) kırmızı çıkıyor. Tam çözüm: Defender'a kütüphane ve temp klasörü için istisna eklemek (yönetici izni ve kullanıcı onayı gerekir).
- Test kopyası `AI.zip` içinde: `Blender_Dort_Grubu_Remesh_Kaydet · AI kopya · 2026-10-17 13.07`. Kullanıcının orijinal dosyası değişmedi.
