# Sürüm notu — 1.9.67 (Nubbo-XP-Navigator: tuval gezgini + tek birleşik OCR ayarı)

Kaynak: `Nubbo-XP-Navigator`. `KURULUM.txt`: **`agent-flow-update.patch`** → önceki **`a81705e`** XP teslimatı ✓;
`cumulative` → `6edcdcc` ✓. Ölçüm ✓: **update düz `--check` = 0** ✓ (benim ağacım = o XP teslimatı = 1.9.66 ✓);
kümülatif **uygulanamaz** ✗ → **yalnız update**, **zorlamadan** ✓; `git diff --check` **0** ✓; 20 giriş ✓.

## Gelen
- **Node sekmesi = tuval gezgini** ✓ (`src/components/NodeNavigator.tsx` ✓ + `src/lib/canvas-navigation.ts` ✓):
  **bulunduğunuz paketin içeriğini** listeler ✓; **tek tık** → seçmeden **merkeze git** ✓ (paketse **içine gir** ✓);
  **çift tık** → merkeze git **+ ayarları aç** ✓; **geri / ileri / dışarı** gezinme ✓ ve **çalışma durumuna
  uygun parlamalar** ✓.
- **Hiyerarşi yeniden düzenlendi** ✓: `NodeHierarchy.tsx` ✗ ve `canvas-hierarchy.ts` ✗ **kaldırıldı**, yerine
  gezgin + `canvas-navigation.ts` ✓ geldi; `SidePanel.tsx` ✓, `LlmPanel.tsx` ✓, `NodeCanvas.tsx` ✓,
  `App.tsx` ✓, `styles/workspace.css` ✓ güncellendi ✓; yeni testler ✓ (`canvas-navigation` ✓,
  `node-navigator-ui` ✓, `ocr-stage-migration` ✓).
- **Tek birleşik OCR ayarı** ✓ (Windows + ONNX ✓): `electron/agent.ts` ✓, `electron/llm-flow.ts` ✓,
  `electron/graph-types.ts` ✓ — **90° tarama korunuyor** ✓.
- **Aero yok** ✗ (XP tek tema ✓); yürütme/OCR motoru ve girdi davranışı **yeniden yazılmadı** ✓.

## Paketin ATLADIĞI bir şeyi ben yakaladım ve düzelttim (dürüst kayıt)
Paketin doğrulaması **yalnız Vitest'i** koşmuş ✓ (514 ✓); **sekiz Node regresyon paketini** değil ✗ → bu yüzden
`npm run test:targeting` **kırmızı** çıktı ✗: `scripts/test-targeting.cjs` içindeki
*"ONNX fallback uses its own fresh boxes…"* testi **ayrı bir `onnx` aşaması** bekliyordu ✗ — oysa bu güncelleme
OCR aşamalarını **birleştirdi** ✗. Testi **yeni sözleşmeye** çevirdim ✓
(*"combined OCR scan uses its own fresh boxes without sending input"* ✓): kelimeler artık **aynı gözlemde**
geliyor ✓, güvence **korunuyor** ✓ (taze kutular kullanılır ✓, **girdi gönderilmez** ✓, merkez 550,315 ✓).
**Test gevşetilmedi** ✗, yalnız şekil gerçeğe uyduruldu ✓. (Bu, benim kapımın işe yaradığının kanıtı ✓.)

## Doğrulama
- Referans kaynak kopyasıyla **içerik karşılaştırması** ✓ (satır sonu normalize ✓): **fark 0 · eksik 0** ✓
  (`App.tsx` ✓, `NodeNavigator.tsx` ✓, `SidePanel.tsx` ✓, `LlmPanel.tsx` ✓, `NodeCanvas.tsx` ✓,
  `canvas-navigation.ts` ✓, `workspace.css` ✓, `agent.ts` ✓, `llm-flow.ts` ✓, `graph-types.ts` ✓,
  `XP-WORKSPACE.md` ✓).
- `typecheck` ✓ · `build:electron` ✓ · **Vitest 69 dosya / 519 test** ✓ (paketin 514'ü + Windows'a bağlı
  5 atlamanın tamamı ✓) · **`test:targeting` 20/0** ✓ · **beş npm paketi** ✓ ·
  **sekiz Node regresyon dosyası 117/0** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
**Canlı görsel denetim yapılmadı** ✗ — gezginin **tek/çift tık** davranışı, **içine gir/dışarı** gezinme ve
parlamalar, **OCR aşama göçünün** canlı etkisi, XP kaydırma okları, boş çalışma alanı seçicileri ve
**Windows ölçeği** denenmedi ✗ (paket de *"Windows EXE görünümü görsel olarak doğrulanmadı"* diyor ✓).