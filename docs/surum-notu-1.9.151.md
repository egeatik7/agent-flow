# Sürüm notu — 1.9.151

**Taban:** `63a0963` (1.9.150 + F0–F2 belgeleri).

## Ne değişti

- **Adım süresi günlüğü (yalnız log).** Her yürütücü adımı için tek satır: `Süre: “…” toplam … · bekleme … · tarama … · model …`. Davranış değişmedi; sarmalayıcılar argüman ve sonucu olduğu gibi geçirir. (`electron/step-timing.ts`, `electron/a11y-bridge.ts` `scan`, `electron/openrouter.ts` `guardedFetch`, `electron/agent.ts` `pause` ve yürütücü sarmalayıcıları.)
- **Kurtarma raporu düzeltildi.** Yeniden denenen adım başarılı olunca "Kurtarma sonrası devam başarısız" görünmüyor; rapor `resumed: true` kaydediliyor. Eski erken "başarısız" çağrısı kaldırıldı (`electron/runner.ts`, `persistentStep`).
- **Öğe hatası politikası testi güncellendi.** Kurtarma ajanı bağlı değilken bir öğe hatası koşuyu o öğede durdurur; sonraki öğeler çalışmaz. Bu, 1.9.146'dan beri olan davranış; test buna göre yazıldı.

## Testler

- Hedefleme: kayıtlı konum son çare olarak tıklanır (110,120; etiket "son çare"; girdi gönderimi 0).
- GUI: bozuk yanıtta aynı model bir kez daha denenir, sonra yedek.
- Kararlılık harness'i: sahte bağımlılıklar gerçek derlenmiş modüllerden besleniyor.
- Yeni: `tests/step-timing.test.ts` (5 test).

## Bilinen

- F2 (zip rename EPERM) kapatıldı; kararsız test olduğu gibi duruyor.
- Canlı masaüstü koşusunda `Süre:` satırının görünmesi bu sürümde doğrulanmadı.
