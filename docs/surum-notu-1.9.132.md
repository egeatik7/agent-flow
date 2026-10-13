# Sürüm notu — 1.9.132 (OCR kelime, bellek süreci, görsel JSON)

**Taban:** `54b9dd0` (1.9.131). Kaynak yama: `nubbo-1.9.131-ocr-bellek-gorsel.patch`.

Üç düzeltme. Blender açılışına yeni doğrulama eklenmedi. Node şeması, kayıtlı akış, model sırası ve ekran tepki modu duruyor.

## Ne değişti

1. **OCR kelime seçimi.** Tek etikette birden fazla geçerli kelime, tek başına `null` nedeni değildir. “User Perspective” için aynı etiketteki gözlenmiş bir kelime seçilebilir. OCR’nin birleştirdiği farklı hedeflerde belirsizlik sürerse `null` kalır. Eski varsayılan prompt metni yeni varsayılana geçer; kullanıcının değiştirdiği özel prompt korunur.

2. **Bellek.** `Get-Process` üzerinde olmayan `ParentProcessId` yerine Windows Toolhelp anlığından ebeveyn PID okunur. `llama-server`, Ollama kökünden ayrı açılmış olsa da model toplamına girer. Aynı PID iki kez sayılmaz. Private bytes ile working set ayrı kalır. Eksik sayaç `0` yapılmaz. Bu, tüketimi düşürmez; yanlış 0,1 GB gösterimini düzeltir.

3. **Görsel JSON.** Tekrarlanan veya Unicode ile gizlenmiş anahtar, serbest metinli ya da birleştirilmiş JSON nokta sayılmaz. İzinli alanlar ve benzersiz anahtarlar gerekir. Koordinat anahtarı tahmin edilmez. Bozuk cevap mevcut red ve yedek zincirine gider. TARS ve normal sohbet ayrıştırıcısı değişmedi.

## Ölçüm

- Typecheck geçti.
- Yamanın hedeflediği sekiz Vitest dosyası: 122/122.
- Tam Vitest: 1096 geçti, 3 kaldı.
  - `badge-id-resolution.test.ts` iki hata. Yama bu yolu değiştirmiyor; taban notunda da aynı iki hata vardı. Model metni ile bozuk OCR satırı `listedTextAgrees` ile çelişince rozet seçimi düşüyor.
  - `zip-library-storage.test.ts` bir kez `EPERM` rename verdi, hemen ardından aynı dosya 27/27 geçti. ZIP kodu bu yamada yok; aralıklı dosya kilidi.
- Windows’ta `scripts/test-memory-process-snapshot.cjs` geçti: toplayan PowerShell’in ebeveyni bu Node süreciydi, private bytes ve working set sıfırdan büyüktü.
- Canlı süreç: PID 23940 `ollama app.exe`, PID 14488 onun çocuğu `ollama.exe serve`. Kolektör aynı iki PID’yi ve aynı ebeveynleri yazdı. `llama-server` o anda çalışmıyordu; 7 GB karşılaştırması yapılamadı.
