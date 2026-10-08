# Sürüm notu — 1.9.56 (Nubbo_Selected_Run_Fix)

Kaynak: kullanıcının `Nubbo_Selected_Run_Fix` paketi (taban `55e45aa` = v1.9.55). SHA256SUMS doğrulandı:
**8/8 AYNI** ✓. Ters kontrol başarısız → düz kontrol başarılı → **zorlamadan** uygulandı ✓; `git diff --check`
temiz ✓; **3 dosya** ✓ (`src/App.tsx`, `electron/runner.ts`, yeni `tests/run-selected-canvas.test.ts` ✓).

## Bu paket, 1.9.55'te BENİM açtığım üç hatayı düzeltiyor (dürüst kayıt)
1. **`onRunFromSelected` → `runAllCanvases(selectedNodeId)`** bağlarken açık **paket yolu `[]`** gönderiliyordu ✗
   → seçili node **paketin içindeyse** motor daha ilk eylemden önce *"Başlangıç node'u bulunamadı"* diyordu ✗
   (kullanıcının üç kısa logu bunu gösteriyor ✓).
2. Yeni yol **ilk tuvalin döngü işaretlerini sıfırlıyordu** ✗ → paket yolu düzelse bile seçili **dosya/öğe**
   yerine **ilk öğeden** başlardı ✗.
3. Motorun **paket yolundan devam eden kolu**, ana tuvalin **Bitti sonucunu döndürmüyordu** ✗ → sıra
   sürücüsü **sağdaki tuvali başlatamıyordu** ✗.

## Düzeltmenin sınırı (paketin metni)
- Açık **paket yolu**, tuval görünümü değiştirilmeden **önce** alınır ✓; yalnızca **ilk tuvalin seçili
  koşusuna** verilir ✓.
- Seçiliden çalıştırmada **ilk tuvalin döngü işaretleri korunur** ✓; normal oynatma ve **sağdaki yeni
  tuvaller ilk öğeden** başlar ✓.
- Paket içinden ana tuvale dönüşte **ana tuvalin gerçek Bitti sonucu** taşınır ✓; **paketin kendi Bitti'si
  ana tuvalin Bitti'si yerine geçmez** ✓.
- OCR, tıklama, yazma, modeller, popup davranışı ve mevcut akışlar **değişmedi** ✓; yeni koşul/başarı
  denetimi **eklenmedi** ✗. `package.json` sürümü paket içinde değiştirilmemişti ✓ (sürüm artışını ben yaptım ✓).

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest: 52 dosya, 396 test geçti** ✓ (paketin beklentisiyle uyumlu ✓; yeni 10 vaka dahil ✓)
- **Sekiz Node regresyon dosyası: 116 pass / 0 fail** ✓ (paketin 116'sı ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Canlı Windows/Electron denemesi yapılmadı** ✗ (paket Linux'ta sınandı ✓); gerçek fare/klavye ile
  seçili koşu denenmedi ✗.
- Canlı kontrol önerisi ✓ (üretim/remesh akışını fikstür yapma ✗; kısa Zamanlayıcı + Bitti olan geçici
  tuvaller ✓): (1) **paket içinde ikinci adımdan** Seçiliden Çalıştır → **önceki adım tekrarlanmamalı** ✓;
  (2) **iç içe iki pakette** seçili adım → *"Başlangıç node'u bulunamadı"* **olmamalı** ✓; (3) **işaretli
  ikinci döngü öğesinden** devam → ilk öğe **tekrarlanmamalı** ✓, sonrakiler çalışmalı ✓; (4) ana tuval
  Bitti'ye ulaşınca **sağdaki** tuval başlamalı ✓, **soldaki çalışmamalı** ✓, **Durdur** kalan sırayı
  başlatmamalı ✓.