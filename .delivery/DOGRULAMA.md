# DOGRULAMA.md — komutlar, sonuçlar ve canlı doğrulama sınırı (SON)

## Çalıştırılan kontroller (dal `fix/bulgu-taramasi-1.9.120`, son HEAD dfe438b)
| Kontrol | Komut | Sonuç |
| --- | --- | --- |
| Tip denetimi | `npm run typecheck` | **0 hata** |
| Tam Vitest | `npx vitest run` | **128 dosya / 915 geçti / 0 kırmızı** |
| Node paketleri | `test:targeting\|stability\|input\|keys\|recovery\|lock` | hepsi **0 kırmızı** (son tam koşular) |
| PowerShell harness | `scripts/test-*.ps1` (12 dosya) | hepsi **exit 0** (son tam koşu) |
| Patch temiz taban | `git worktree add --detach tmp 1d643b2 && git apply --check patch` | **exit 0** |

## Düzeltilen maddeler (18)
U01, U03, U04, U05, U06, U07, U08, D06, D10, O04, O05, O11, O13, O14, O16, O17, O18, O19, O20, O21, O22
(her biri ilgili commit + tablodaki test/ölçüm kanıtıyla).

## Canlı doğrulama YAPILMAYAN maddeler
U01 (gerçek foreground) · U03 (Denetimli klasör erişimi) · O04 (gerçek 401/402) · O05 (gerçek çoklu monitör) · O18 (tablet görsel) · O19 (gerçek powershell.exe çıktısı) · U02 (düzeltme bekliyor).

## Test borcu / açık kayıt
O11, O17, O22 için hedefli birim testleri yok (typecheck + tam suite ile doğrulandı). `tests/zip-library-storage.test.ts` kararsız (**K01**), assertion gevşetilmedi.

## HENÜZ ELE ALINMADI
O01, O02, O03, O06, O07, O08, O09, O10, O12, O15 · D01–D05, D07–D09, D11–D17 · E01–E03 · raporda eksik 7 kayıt.
