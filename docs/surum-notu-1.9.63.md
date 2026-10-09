# Sürüm notu — 1.9.63 (AgentFlow-Aero 3/3: Aero robot + wordmark)

Kaynak: kullanıcının ikinci Aero paketi `AgentFlow-Aero (2)` — `agent-flow-aero.patch` **üç commit**:
`[PATCH 1/3]` + `[PATCH 2/3]` (bunlar **1.9.62'de zaten uygulandı** ✓) + **`[PATCH 3/3] Add Aero robot and
wordmark while sharing layout geometry between skins`** ✓.

## Uygulama yöntemi (dürüst kayıt)
Üst küme patch'in **düz `--check`'i başarısız** ✗ (`docs/aero-reskin/README.md already exists` ✗,
`src/App.tsx patch does not apply` ✗) ve **ters `--check`'i de başarısız** ✗ (mevcut ağaç 1./2. commit'lerin
sonucu ✓ ama 3. commit'in *öncesi* değil ✓). **Zorlamadım** ✗; rehberin mantığıyla yalnız **3. commit'in
bölümünü** ayırdım ✓ ve **bayt düzeyinde** (BOM'suz UTF-8, LF korunarak ✓) geçici bir patch yazdım ✓:
`--check` **0** ✓ → **uygulandı** ✓ → `git diff --check` **0** ✓. (İlk denemem `Out-File` ile yazdığım için
dosyayı **bozdu** ✗ — `git diff header lacks filename information` ✗; bu yüzden yöntemi değiştirdim ✓.)

## Gelen
- **`src/assets/nubbo-aero.png`** (1,1 MB ✓) + **`src/assets/nubbo-logo-aero.png`** (1,5 MB ✓) — Aero robot
  ve wordmark ✓.
- **`src/components/NubboMascot.tsx`** ✓ ve **`src/components/Hud.tsx`** ✓ — tema ile **ortak yerleşim
  geometrisi** kullanıyor ✓ (skin'ler arasında paylaşılıyor ✓).
- **`src/styles/aero.css`** ✓ (18,2 KB ✓) ve **`docs/aero-reskin/README.md`** ✓ güncellendi ✓;
  `aero.png`/`xp.png` karşılaştırma görselleri yenilendi ✓.

## Doğrulama
- **Metin dosyaları** (`App.tsx`, `NodeCanvas.tsx`, `NubboMascot.tsx`, `aero.css`, `README.md`): referans
  kopyayla **içerik ÖZDE AYNI** ✓ (fark yalnız **satır sonu** ✓: bu repo CRLF yazıyor ✓, paket LF ✓ —
  1.9.62 notundaki düzeltmeyle aynı durum ✓).
- **Görseller**: `nubbo-aero.png`, `nubbo-logo-aero.png`, `aero.png`, `xp.png` → **ham SHA256 ile AYNI** ✓.

## Ölçülen (gerçek Windows)
`npm run typecheck` ✓ · `npm run build:electron` ✓ · **Vitest 63 dosya / 486 test** ✓ · **beş npm paketi** ✓
(`test:keys/input/recovery/targeting/stability` ✓) · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
- **Canlı görsel denetim yapılmadı** ✗ — Aero robot/wordmark görünümü, Aero ⇄ XP geçişi, HUD, açılış
  teması, node/port kayması, Tuvaller/silme uyarısı, paket içine girip çıkma, uzun değişken kutusu,
  El Kitabı, Ekran Tarayıcı, küçült/büyüt ve Windows ölçeği denenmedi ✗.
- Rehberin söz ettiği **`npm run test:ui:theme`** ✗ ve **`electron/ui-theme.ts`** ✗ bu pakette de **yok**
  ✓ (başka bir varyanta ait ✓) → o komut çalıştırılamadı ✗.
- Gerçek otomasyonun başarısı renderer testinden **çıkarılmadı** ✓.