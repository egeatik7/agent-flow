# OCR kelime seçimi, model belleği ve görsel JSON düzeltmesi

Taban: 1.9.131, commit `54b9dd01a380684daf23689441775574e071e738`.

Bu patch üç değişiklik içerir. Blender açılışına veya eylem sonrasına yeni doğrulama eklenmez.
Runner, node şemaları, kullanıcının JSON'ları, model sırası, üretim ayarları ve ekran tepki modu değişmez.

## Değişiklikler

1. `WORD_CHOICE_PROMPT`: tek etiketteki birden fazla geçerli kelime tek başına `null` nedeni değildir.
   "User Perspective" için aynı etikete ait herhangi bir gözlenmiş kelime seçilebilir.
   OCR'nin birleştirdiği farklı hedeflerde belirsizlik varsa `null` korunur. Ekran/geçmiş veya
   ilk modelin kararı eklenmez. Yalnız eski varsayılanın tam metni yeni varsayılana geçirilir;
   değiştirilmiş özel promptlar korunur. Önceden eklenmiş `#217` ID desteği korunur.

2. Bellek: `Get-Process` nesnesindeki mevcut olmayan `ParentProcessId` yerine, Windows Toolhelp
   snapshot'ından ebeveyn PID okunur. `llama-server` Ollama kökünden bağımsız başlatılmış olsa bile
   aynı model toplamına girer. Ağaç ve tanınan çalıştırıcılar PID ile birleşir; iki kez sayılmaz.
   Gerçek private bytes ve working set ayrı kalır. Eksik/null sayaç `0` yapılmaz.
   Bu değişiklik bellek tüketimini azaltmaz veya sızıntıyı çözmüş olduğunu iddia etmez;
   önce yanlış 0,1 GB gösterimini düzeltir. Süreç gruplama saf TypeScript işlevinde sınanır.

3. Görsel JSON: eski parser `JSON.parse` ile tekrarlanan alanın son değerini kabul ediyordu.
   Kaydedilen GUI-Owl cevabındaki iki `x` ve garip anahtarlar bu yüzden noktaya dönüşebiliyordu.
   Yeni görsel parser tek nesne, izinli alanlar ve benzersiz anahtarlar ister; Unicode ile
   yazılmış aynı anahtarı da yakalar. Başına/sonuna serbest metin eklenmiş veya birleştirilmiş
   JSON'dan parça seçmez. Tam JSON markdown çiti desteklenir. Koordinat anahtarı tahmin edilmez.
   Hatalı yanıt mevcut `ModelRejected` / yedek zincirine gider. TARS ve normal sohbet parser'ı
   değişmez. Bu bir model çıktısı ayrıştırma düzeltmesidir; GUI-Owl'ın neden bozuk yanıt ürettiği
   canlı model olmadan kanıtlanmadı ve model/template/quant ayarlarına dokunulmadı.

## Yerel doğrulama (Linux, 13 Ekim 2026)

- `npm run typecheck`: geçti.
- Sekiz hedefli Vitest dosyası: 122/122 geçti.
- Son bellek kolektörü sadeleştirmesinden sonra iki bellek test dosyası: 47/47 geçti;
  typecheck ve build:main tekrar geçti.
- `npm run build:electron`: geçti. Sonraki değişiklik yalnız bellek main modülündeydi;
  build:main yeniden çalıştırıldı.
- Sekiz Node regresyon dosyası: 95 geçti, 21 mevcut/platforma bağlı test atlandı, hata yok.
- Tam Vitest: 1090 geçti, 4 başarısız, 5 atlandı. Temiz geçit değildir:
  - `badge-id-resolution.test.ts`: iki hata aynı taban commitin değişikliksiz worktree'sinde
    de birebir tekrarlandı. Bu patch OCR rozet çözüm yolunu değiştirmiyor.
  - `render-overflow-audit.test.ts`: iki hata, bu ortamda `/opt/google/chrome/chrome` olmadığı için.
    Kart bileşenleri/CSS bu patch ile değiştirilmedi.
- Gerçek Windows/PowerShell 5.1 Toolhelp kolektörü, Ollama ve fare tıklamaları burada çalıştırılmadı.
  Windows kontrolü Linux'ta SKIP verir; bu canlı doğrulama sayılmaz.

## Cursor: uygulama ve teslim

1. Patch'i repo köküne koy. Güncel çalışma ağacını ve HEAD'i kontrol et; kullanıcının değişikliklerini koru.
   Önce `git apply --reverse --check nubbo-1.9.131-ocr-bellek-gorsel.patch` ile zaten uygulanmış mı bak.
   Uygulanmamışsa `git apply --check nubbo-1.9.131-ocr-bellek-gorsel.patch` ardından normal `git apply` kullan.
   HEAD farklıysa hunları ilgili güncel dosyalara uyarlayıp raporla; force/reject/reset veya toplu kopyalama yapma.
2. Typecheck, hedefli testler, tam test ve build çalıştır. Yukarıdaki taban hatalarını gizleme veya
   sırf yeşil sonuç için testleri gevşetme. Mevcut testlerin güncel beklentilerle ilişkisini incele.
3. Windows'ta build:main sonrası `node --test scripts/test-memory-process-snapshot.cjs` çalıştır.
   Bu test gerçek ölçüm PowerShell'inin ebeveyn PID'sini Node PID'siyle karşılaştırır ve RAM sayaçlarını okur.
4. Model zaten çalışıyorsa Nubbo model grubu ile görev yöneticisinin ilgili PID'lerini karşılaştır.
   Commit'i fiziksel RAM ile karşılaştırma; private bytes ve working set'i kendi sayaçlarıyla karşılaştır.
   Ağır remesh başlatma, RAM temizleme/model boşaltma veya yeni eylem doğrulaması ekleme.
5. Özel wordChoice promptu kullanılıyorsa otomatik değiştirme; yeni kuralın özel promptta da
   istenip istenmediğini kullanıcı talimatına göre ele al. Yerleşik varsayılan ve eski varsayılan
   kayıtları otomatik güncellenir.
6. Uygulanmış kaynak test edildikten sonra güncel sürümden bir sonraki sürümü üret, commit/etiketi
   push et ve EXE'yi sürümlü adla masaüstüne koy. Eski EXE'yi koru. Tekrar izin isteme.

Özet test komutu:

```sh
npx vitest run tests/visual-reply-json.test.ts tests/visual-target.test.ts tests/visual-pointer.test.ts tests/memory-process-snapshot.test.ts tests/memory-meter.test.ts tests/word-choice-label-prompt.test.ts tests/ocr-word-choice.test.ts tests/prompt-defaults.test.ts
```

Son raporda sürüm, commit SHA, EXE yolu/hash ve gerçek Windows ölçümünün yapılıp yapılmadığını belirt.
Bu patch başlı başına EXE değildir; taban sürümün package.json numarasını değiştirmez.
