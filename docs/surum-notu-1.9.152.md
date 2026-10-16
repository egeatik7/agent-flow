# Sürüm notu — 1.9.152

**Taban:** `c789421` (1.9.151). Davranış değişikliği yok; düzenleme ve belge.

## Ne değişti

- **GUI-Owl koordinatı tek yerde.** Model ızgarasındaki (0–1000) nokta → ekran noktası dönüşümü `electron/visual-geometry.ts` içinde. Eskiden iki ayrı kopya vardı (agent.ts). İç noktalar eski formülle birebir aynı; yalnız ızgaranın en uç değeri (1000) alan dışına bir piksel taşmak yerine alanın son pikselinde kalıyor.
- **Bekleme sayılarına ad.** `electron/timing-constants.ts`: 420, 3000, 900, 2000, 2500, 240, 5000, 1500 ms artık FOCUS_SETTLE, REFRESH_RETRY, REACTION_SETTLE, LOADING_RECHECK, NEXT_ITEM_WAIT, ENTER_GAP, LOCK_POLL, UNLOCK_SETTLE adlarıyla. Değerler aynı; bir test değerleri ve agent.ts içinde çıplak sayı kalmadığını kontrol ediyor.
- **Durma kapıları kataloğu** (`docs/durma-kapilari-katalogu.md`): 159 durma noktası §19 sorusuyla sınıflandırıldı. Kod değişmedi; kararlar kullanıcıda.

## Testler

- `tests/visual-geometry.test.ts` (7): negatif x (sol monitör), %125 DPI, köşeler, eski formülle birebir karşılaştırma.
- `tests/timing-constants.test.ts` (2): değerler ve çıplak bekleme kontrolü.
- PowerShell `scripts/test-visual-crop-geometry.ps1`: 6/6 geçti (sentetik, masaüstü girdisi yok).

## Bilinen

- `zip-library-storage` testi bilinen kararsız (EPERM, Windows). Bu sürümde 3 koşudan 1'inde kırmızı çıktı; kullanıcı kararıyla kabul edildi.
- `screenArea()` (tek monitör varsayımı) için kanıt yok; değiştirilmedi.
