# Sürüm notu — 1.9.157

**Taban:** `059f990` (1.9.156).

## Ne değişti

- **Kopyala-sonra-çalış.** Test oturumunda otomatik merge, AI dışındaki bir tuvale denk gelirse önce tuvalin kopyası `AI` grubuna alınır (Farklı kaydet mantığı, adı "… · AI kopya"). Açık sekme kopyayı gösterir; orijinal ZIP değişmez. Değişiklik kopyada yapılır.
- `AI` grubu yoksa ya da kopya oluşmazsa hiçbir şey yazılmaz ve nedeni bildirilir.

## Testler

- Tüm geçit yeşil; vitest 1330/1330. Pencere tarafı (kopyalama) birim testiyle değil, canlı denemeyle doğrulanır.

## Bilinen

- `zip-library-storage` testi (EPERM) kararsız; bu koşuda geçti.
