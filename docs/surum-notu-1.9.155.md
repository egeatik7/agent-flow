# Sürüm notu — 1.9.155

**Taban:** `028e2f7` (1.9.154).

## Ne değişti

- **Test profilinde otomatik merge.** `NUBBO_PROFILE=test` ve `NUBBO_TEST_TOOLS=1` iken `branch.merge apply` insan tıklaması olmadan uygulanır: pencere aktif tuvali değiştirir ve ZIP'e kaydeder. Gerçek profilde değişmedi (reddediliyor). Kural: CLAUDE.md §21.
- Pencere tarafında yeni kanal `agent:graph` (uygulama isteği) ve `agent:graph-applied` (cevap). Uygulama yalnız aktif tuvalde; koşu sürerken ya da 20 sn cevapsızken hiçbir şey yazılmaz.

## Testler

- `tests/tool-auto-apply.test.ts` (3): gerçek profilde reddi, test oturumunda tek uygulama ve doğru tuval/grafik, pencere reddederse başarısızlık bildirimi. Kapı açılınca ilk test kırmızıya dönüyor (kasıtlı hata ile doğrulandı).

## Bilinen / doğrulanmadı

- Pencere tarafı (`App.tsx`) birim testiyle değil, yalnız tip kontrolüyle doğrulandı. Canlı uçtan uca denemede test penceresinde açık bir tuval olmalı; bu gece açık tuval yoktu.
- `zip-library-storage` testi bilinen kararsız (EPERM).
