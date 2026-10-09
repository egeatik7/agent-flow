# Sürüm notu — 1.9.64 (AgentFlow-Aero 4/5 + 5/5: native Acrylic + cilalı maskot)

## ÖNEMLİ: paket güncellenmişti ✗
`AgentFlow-Aero` klasörü **09.10 20:33'te yenilendi** ✓ ve patch **2 → 5 commit** oldu ✗:
`[PATCH 4/5] Add supported native Acrylic backdrop and richer semantic` ✗ +
`[PATCH 5/5] Polish opaque toy mascot and reference-shaped Aero` ✗ — bunlar bende **yoktu** ✗
(kanıt: `--loop-color` **0** ✗ (patch 5 ✓), `nativeRequest` **0** ✗ (patch 4 ✓), `aero.css` 227 ✗ vs 301 ✓,
`theme.ts` 38 ✗ vs 50 ✓, `f2effa` **0** ✗ (patch 2 ✓)). Bu yüzden **1.9.62/63 eksikti** ✗ — şimdi tamam ✓.

## Uygulama yöntemi (zorlama yok ✗)
Üst küme patch'in düz `--check`'i de ters `--check`'i de **başarısız** ✗ (1./2./3. commit'ler zaten uygulanmış ✓,
4./5. commit'lerin **öncesi** mevcut değil ✗). Rehberin mantığıyla **yalnız 4. ve 5. bölümleri** ayırdım ✓
(`From <40hex>` sınırlarından ✓, **bayt düzeyinde** BOM'suz UTF-8 / LF korunarak ✓) → her biri için
`git apply --check` **0** ✓ → **uygulandı** ✓ → `git diff --check` **0** ✓.

## Gelen
- **`electron/window-theme.ts`** ✓ (yeni ✓) + `electron/main.ts` ✓ + `electron/preload.ts` ✓ + `src/types.ts` ✓
  → **desteklenen native Acrylic arka plan** ✓ (pencere arka planı tema ile eşleşiyor ✓).
- **`src/lib/theme.ts`** (38 → 50 satır ✓) — `nativeRequest` sayaç/mantığı ✓; `src/main.tsx` ✓ HUD sorgu
  parametresi ✓; `src/components/NodeCanvas.tsx` ✓ (`--loop-color` ✓ = döngü çerçevesi rengi ✓).
- **`src/styles/aero.css`** (227 → 301 satır ✓) — **referans biçimli** Aero ✓ (gövde `#f2effa` ✓) +
  **opak oyuncak maskot** cilası ✓.
- **`src/lib/package-appearance.ts`** ✓ ve **`src/assets/nubbo-aero.png`** (1121 → **740 KB** ✓ = yeni maskot ✓).
- **`tests/window-theme.test.ts`** ✓ (yeni test ✓) + `docs/aero-reskin/details.png` ✓ (yeni görsel ✓).

## Doğrulama — paketin **güncel** kaynağıyla
- **9/9 metin dosyası «İÇERİK AYNI»** ✓ (`theme.ts` ✓, `main.tsx` ✓, `NodeCanvas.tsx` ✓, `NubboMascot.tsx` ✓,
  `Hud.tsx` ✓, `Toolbar.tsx` ✓, `App.tsx` ✓, `aero.css` ✓, `README.md` ✓) — satır sonu normalize edilerek ✓
  (bu repo CRLF ✓, paket LF ✓; fark **yalnız** satır sonu ✓).
- **5/5 görsel «HAM AYNI»** ✓ (`details.png` 348,5 KB ✓, `aero.png` 323,5 KB ✓, `xp.png` 97 KB ✓,
  `nubbo-aero.png` 739,9 KB ✓, `nubbo-logo-aero.png` 1.542,7 KB ✓).

## Ölçülen (gerçek Windows)
`typecheck` ✓ · `build:electron` ✓ · **Vitest** ✓ (yeni `window-theme` testi dahil ✓) ·
**beş npm paketi** ✓ · **sekiz Node regresyon dosyası** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
**Canlı görsel denetim yapılmadı** ✗ — **native Acrylic arka plan** görünümü, Aero ⇄ XP geçişi, maskot,
HUD/açılış teması, node/port kayması, Tuvaller/silme uyarısı, paket içine girip çıkma, uzun değişken kutusu,
El Kitabı, Ekran Tarayıcı, küçült/büyüt ve **Windows ölçeği** denenmedi ✗. (Rehberin `ui-theme` adı bu
pakette **`window-theme`** olarak geçiyor ✓; `npm run test:ui:theme` komutu **yine yok** ✗.)