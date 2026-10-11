# Sürüm notu — 1.9.85 (sürüm yükseltmesi; **kod değişmedi**)

Kullanıcının talebi ✓: *“masaüstüne koy githuba da pushla 1.9.85”*.

**Kod değişmedi** ✗: bu sürüm **`61ef2c6` ile birebir aynı** kodu içerir ✓; yalnız `package.json` / `package-lock.json`
sürüm alanı **1.9.84 → 1.9.85** oldu ✓. **Neden** ✓: masaüstünde **çalışan** `Nubbo-1.9.84.exe` **kilitli** ✗
(kullanıcının kendi derlemesi ✓, hash `D2BF848A…` ✓) → yeni derleme **çakışmayan** bir adla konabilsin ✓ ve yayın izi
netleşsin diye ✓.

## İçerik (hepsi `61ef2c6`'dan geliyor ✓)
1. **Koşu öncesi eksik döngü yolu raporu** ✓ (`src/lib/item-paths.ts` ✓ + `paths:missing` IPC ✓ +
   `MissingPathsNote.tsx` ✓ + `App.tsx` guard'ı ✓).
2. **Ollama adreslerinde düşünmeyi kapatma** ✓ (kullanıcının/Cursor'un **`a8e28a4`** commit'i ✓,
   `reasoning_effort: 'none'` ✓, *11 Ekim 2026 ölçümü* ✓).

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 89 dosya / 640 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **PS 5.1'de 10 harness** ✓ · `pack:win` ✓ · **masaüstü kopyası hash ile doğrulandı** ✓ ·
**ASAR'ın içinden** yeni kodun varlığı ölçüldü ✓ (`paths:missing` ✓, `missing-paths-list` ✓, `reasoning_effort` ✓).

## Doğrulanmayan (dürüst ✗)
**Rapor penceresinin canlı görünümü** ✗ ve **gerçek eksik yollu koşu** ✗ hâlâ denenmedi ✓;
masaüstündeki **eski `Nubbo-1.9.84.exe`** kullanıcının oturumu tarafından **kilitli** olduğu için **silinemedi** ✗
(kapatınca silinebilir ✓).