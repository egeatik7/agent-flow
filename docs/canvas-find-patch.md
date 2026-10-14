# Tuvalde Ctrl+F araması

Taban: `36bc5bb` (1.9.134). Bu patch yalnız tuvalde arama ve gezinme ekler. Node komutlarını, OCR/LLM davranışını ve kayıtlı akış JSON'larını değiştirmez. Sürüm artırımı veya Windows EXE üretimi içermez.

## Kullanım

- Fareyi tuvalin üzerine getirip Ctrl+F bas.
- Aranacak metni yaz; Enter veya **Ara** ile aramayı başlat. Yazarken arama yapılmaz.
- Ekrandaki ← / → düğmeleri veya arama kutusu odaktayken klavyedeki sol / sağ oklarla sonuçları gez.
- Arama açık tuvalin tamamını, iç içe paketleri ve döngü nodelerini kapsar. Başka açık sekmeler aranmaz.
- Sonuçlar her paket düzeyinde x konumuna göre soldan sağa, aynı x konumunda yukarıdan aşağıya sıralanır. Paketin sonuçları o paketin ardından gelir.
- Sonuç seçimi paketi açar, nodeyi ortalar ve ayarlarını gösterir. Paketler arasında arama kutusu ve sonuç sırası korunur.
- Sonuç sayacı ve paket yolu görünür. Son sonuçtan sonra ilk sonuca dönülür; Esc veya × aramayı kapatır.
- Tuval sekmesi değişince arama temizlenir. Başlık, talimat, yazılacak metin, tuşlar, klasör/yol ve diğer kullanıcı alanları aranır; ekran görüntüsü, OCR hafızası ve çalışma izleri aranmaz.

## Cursor için uygulama

Çalışma ağacındaki mevcut değişiklikleri koru. Önce `git apply --check nubbo-tuval-ctrl-f.patch` çalıştır. Çakışma varsa ilgili diff'i güncel kodla birleştir; zorla/reset ile uygulama. Ardından `git apply nubbo-tuval-ctrl-f.patch`.

Kontroller:

```sh
npx vitest run tests/canvas-search.test.ts tests/canvas-find.test.ts tests/confirmed-canvas-lock.test.ts tests/run-selected-canvas.test.ts
npm run typecheck
npm run build:electron
```

Windows üzerinde fare tuvaldeyken Ctrl+F → Save As → Enter, a → Ara, klavye okları, iç içe paketler, boş sonuç, Esc ve başka sekmeye geçişi canlı dene. Metin düzenleyicisinde Ctrl+F'nin tuval aramasını açmadığını da kontrol et. Mevcut EXE'yi yeni davranış içeriyormuş gibi sunma; kullanıcıya yeni EXE teslim edilecekse kontrollerden sonra ayrı sürüm/paket oluştur.

## Burada yapılan doğrulama

4 ilgili test dosyası: 34/34 geçti, unhandled hata yok. DOM testlerinde gerçek React arama bileşeni render edildi; App entegrasyonunda paket yolu, node odağı ve JSON'un değişmemesi doğrulandı. Typecheck ve Electron kaynak build'i geçti. Canlı Windows/Electron arayüzü ve EXE bu ortamda denenmedi/üretilmedi. Tam test takımı bu UI patch'i için çalıştırılmadı.
