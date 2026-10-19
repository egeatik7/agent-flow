# Sürüm notu — 1.9.165 (checkpoint yazımı NDJSON, paket içi hedef seçici, piksel döngüleri native)

**Taban:** `a4f6f00` (1.9.164). Bu sürüm, denetimin kalan üç yüksek bulgusunu kapatır; node
türleri/şemaları değişmedi.

## Ne değişti

1. **Checkpoint yazımı O(n²) değil** (`checkpoints.ts`): çıktılar artık append-only
   `<id>.outputs.jsonl` dosyasına satır satır ekleniyor; checkpoint JSON'u yalnız meta taşıyor.
   Her 500 ms'de tüm çıktı dizisi yeniden serileştirilmiyor. `detail()` NDJSON'u okur (eski
   checkpoint'ler JSON içindeki diziyle uyumlu kalır), `prune` bu dosyayı da siler.
2. **Checkpoint paneli donmuyor** (`CheckpointsPanel.tsx`): 100.000 satıra kadar çıktı tek listede
   render ediliyordu (~50 bin DOM düğümü). Artık ilk 300 satır + "Daha fazla göster" düğmesi.
3. **Paket içi hedef seçici iç node'a yazıyor** (`SidePanel.tsx`, `App.tsx`): "Pakette ayarları
   göster" altındaki iç Tıkla/Yazı Yaz için **İmleçle Yakala** ve **Ekrandan Seç** artık paketin iç
   node'una `locator/anchor/prompt` yazar; kök düzeyde sahte Tıkla node'u oluşmaz.
4. **1080p piksel döngüleri kaldırıldı** (`screen.ps1`):
   - Kare, çekilmeden önce opak siyahla dolduruluyor → alfa zaten 255; `Set-BitmapOpaque` örnek
     kontrolüyle anında dönüyor (ölçüm: ~2,8 sn → ~4 ms).
   - 32→24 bit dönüşümü GDI+ `DrawImage` ile yapılıyor (ölçüm: ~9,2 sn → ~8 ms).
   Görüntü içeriği aynı; yalnız dönüşüm yolu değişti.
5. **Hızlı orta bulgular:** `unlinkRetrying` ~3,25 sn yerine ~0,6 sn (Durdur donmuyor);
   tanılama budaması isteği bekletmiyor (`setImmediate`); 24 saatten eski portable işareti bayat
   sayılıyor (PID geri dönüşümü); `act.wait` süresi doğrulanıp 30 dk ile sınırlanıyor; ZIP geçici
   dosya temizliği kilitliyse hata döndürmüyor; `startEndpoint` eşzamanlı çağrıda tek dinleyici
   açıyor; yakalama sayacı sürerken koşu başlatılamıyor.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **195 dosya / 1483 test** yeşil. Yeni: `tests/checkpoint-ndjson.test.ts`
  (meta dosyasında `outputs` yok, NDJSON satırları var, `detail()` birleştiriyor), retention testi
  `.outputs.jsonl` budaması.
  Bilinen flaky: `tests/zip-library-storage.test.ts` (Windows `rename` EPERM; tek başına 27/27).
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- `scripts/test-screen.ps1`, `test-scan-frame.ps1`, `test-visual-crop-geometry.ps1` **geçti**
  (ölçek/kare tutarlılığı, OCR/ONNX/marked aynı kare).
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Canlı ekranda uçtan uca koşu yapılmadı.** Piksel yolu ölçümü sentetik 1920×1080 bitmap ile;
  gerçek Blender/Hunyuan oturumunda taranmadı.
- Paket içi hedef seçici yalnız kod + tip denetimiyle doğrulandı; tıklama akışı UI testi eklenmedi.
- Denetim raporundaki orta/düşük bulguların bir kısmı (merge hedefinin tıklama anında sabitlenmesi,
  `act.*` Durdur semantiği, canvas taslak birikmesi, viewer Origin, HUD interval) sonraki sürümde.
