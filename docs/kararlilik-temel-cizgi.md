# Kararlılık temel çizgisi (F0)

Tarih: 2026-10-17 00:27 (TSS) · Commit: `c28c266` (1.9.150) · Node: v22.23.3
Çalışma ağacı F0 öncesi: `CLAUDE.md` (§20 eklendi, işlenmemiş) ve `docs/kararlilik-eylem-plani.md` (işlenmemiş). Kod değişikliği yok.

## Komutlar ve sonuçlar

| Komut | Sonuç |
| --- | --- |
| `npm run typecheck` (3 tsconfig) | çıkış 0, hata yok |
| `npx vitest run` | 169 dosya geçti, **1302 test geçti**, 0 başarısız |

Not: önceki gözlemde `tests/zip-library-storage.test.ts` Windows `fs.renameSync` EPERM hatası vermişti (dosya kilidi). Bu turda hata çıkmadı; flaky olduğu hâlâ geçerli, F2 hedefi bu.

## Doğrulanan varsayılanlar

- `electron/graph-types.ts:266` `screenCheckMode`: `screenCheck` değeri `off` ya da `on` değilse **`log`** döner. Yani varsayılan yalnızca-günlük. CLAUDE.md §17 ile uyumlu.

## Kabul

- Dosya var, komutlar ve sayılar yazılı. Kod değişmedi; bu yüzden bu faz için sürüm artışı ve exe üretimi yapılmıyor (dokümantasyon-only).
