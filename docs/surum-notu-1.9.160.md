# Sürüm notu — 1.9.160 (checkpoint kapsamı: dosya takibi AKIŞTAKİ klasörlere bağlandı)

**Taban:** `293bada` (1.9.159) + otomatik checkpoint/disk izleme patch'i (`14e39aa`,
`nubbo-checkpoints-auto-full.patch`, SHA256 `6f7592b1…3135f4`).

Bu sürümün tek konusu **dosya takibinin kapsamı**. Checkpoint mantığı (her döngü öğesinin ilk
eyleminden önce graf + imleç + değişken + donmuş liste; aynı öğeden devam) patch'ten **aynen**
korundu; yalnız "neyi izliyoruz" sorusu düzeltildi. Node türleri, JSON şeması, akışların davranışı
ve mevcut kullanıcı ayarları değişmedi.

## Neden değişti (ölçülen sorun)

Patch tüm sürücü köklerini (`C:\` dâhil) `fs.watch(recursive)` ile izliyordu. Ölçüm:

- Boşta C:\ izleme: **1,2 olay/sn**
- Makine hafif meşgulken (vitest + tsc): **34,2 olay/sn** (15 sn'de 514 olay); olayların neredeyse
  tamamı alakasız (`AppData`, `Prefetch`, `Tailscale` günlükleri, başka programların dosyaları).

Sonuç: "hangi dosya benim çıktım" sorusu cevaplanamıyor, checkpoint listesi gürültüyle doluyor,
checkpoint başına 100.000 yol sınırı saatler içinde doluyor ve büyüyen JSON her 500 ms'de yeniden
yazılıyordu (4.000 çıktı = 0,77 MB; 50.000 çıktı = 5,7 MB / 17 ms ana thread).

## Ne değişti

1. **Kökler artık AKIŞTAN gelir** (`electron/checkpoint-roots.ts`, saf/test edilebilir):
   - döngünün `folder` alanı (`{{öğe}}` gibi şablonlar imleç değişkenleriyle çözülür),
   - öğe listesinin **ortak üst klasörü** (60 dosya → 1 kök; 60 kök değil),
   - yazma/taşıma alanlarındaki yollar (`text`, `source`), tırnaklı ve boşluklu yollar dâhil,
   - döngünün **o anki öğesi** (klasörse).
   - Araç dosyalarının (`.exe`, `.dll`, `.bat`, `.ps1`…) klasörü izlenmez: çıktı değildir.
   - İç içe kökler tekilleşir, en fazla **24 kök**, sistem/kurulum/Nubbo kaydı klasörleri atlanır,
     çıplak disk kökü (`C:\`) akışta yazsa bile **izlenmez**.
2. **Tüm disk izleme opt-in oldu (varsayılan KAPALI).** Panelde "Tüm diskleri de izle" anahtarı var;
   açıkken başka programların dosya hareketleri de listelenir ve bu panelde açıkça yazılır
   (`checkpointWideWatch`, `store`'da saklanır; eski ayar dosyasında yok → kapalı).
3. **İzleme hatası artık koşuyu durdurmuyor.** Eskiden hiçbir kök izlenemezse `begin()` hata atıyor
   ve otomasyon hiç başlamıyordu. Artık: izleme boş kalır, durum `issues`/panelde görünür, koşu
   ilerler. (Bir *gözlem* özelliği *işi* durdurmamalı.)
4. **Henüz var olmayan klasör** (ör. `Final Blends` henüz oluşmadı): en yakın var olan üst klasör
   izlenir, yol "oluşunca izlenecek" listesinde gösterilir; 10 sn'de bir tazelenir.
5. İzleme kökü değişince eski izleyici kapanır, yenisi açılır (döngü ilerledikçe kapsam taşınır).

## Gerçek akışta ölçüm

Kullanıcının gerçek tuvali (`Blender_Dort_Grubu_Remesh_Kaydet`) üzerinde yeni çözücü çalıştırıldı:

```
izlenecek kök sayısı: 2   (sürücü kökü: YOK)
  C:\Users\ASUS TUF\Desktop\Plug&Play\Remesh Gruplari     ← döngü öğelerinin ortak klasörü
  C:\Users\ASUS TUF\Desktop\Plug&Play\Final Blends        ← yazı alanındaki çıktı klasörü
```

Araç klasörü (`NubboTools`, bir `.exe` yolu olduğu için) elendi. `HunyuanGLBs`/`OldGLBs` yalnız daha
geniş akışta geçtiği için bu tuvalde yok; geçtiği akışta aynı kuralla bulunur.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **184 dosya / 1420 test** geçti.
  - Yeni `tests/checkpoint-roots.test.ts` (**12 test**): yol ayrıştırma, ortak klasör, şablon çözme,
    iç içe kök tekilleştirme, sınır, sistem klasörü/disk kökü eleme, gerçek akış biçimi.
  - `tests/checkpoints.test.ts` (11), `checkpoint-output-watch.test.ts` (8),
    `checkpoint-ui.test.ts` (5), `checkpoint-runner.test.ts` (8), `checkpoint-resume-tab.test.ts` (2).
  - Kapsam testleri: tüm disk KAPALIyken disk kökünün **izlenmediği**, açıkken izlendiği, kök
    değişiminde eskisinin kapandığı, kök yokken **koşunun durmadığı**, var olmayan klasörün
    "bekliyor" olduğu.
- Beş Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` **40** · `test:lock` 1 — **0 kırmızı**.
- PowerShell harness: **8/12 geçti**. `test-direct-input`, `test-hover-worker`, `test-key-input`,
  `test-input-recovery` **kırmızı** — ancak bunlar **patch'siz 1.9.159 tabanında da aynı** şekilde
  kırmızı (temiz `293bada` arşivinde ölçüldü). Nedeni: 293bada'nın giriş değişikliği
  `[XpKeyboardGuard]` tipini kullanan fonksiyonları harness'ın AST ile çıkardığı yüzeye taşıdı;
  harness `common.ps1`'i yüklemediği için tip bulunamıyor. Bu sürümün konusu değil; **düzeltilmedi**,
  açıkça raporlandı.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- Canlı Windows/Blender uçtan uca koşu **yapılmadı**; gerçek akış üzerinde yalnız **kapsam çözümü**
  doğrulandı (yukarıdaki 2 kök). Electron penceresiyle görsel denetim yapılmadı.
- Dosyaların eski içerikleri saklanmaz, otomatik silme/taşıma/geri yükleme yoktur (patch'in kuralı
  korundu). "Geri dön" için kullanıcı dosyaları kendisi temizler; panel aralık başına hangi
  yolların değiştiğini listeler.
- Dış uygulama durumu (tarayıcı sekmesi, Hunyuan kredisi, Blender'ın kaydedilmemiş sahnesi) geri
  alınmaz. Aynı öğe yeniden çalıştırıldığında dış yan etki tekrar edebilir.
- Checkpoint saklama/temizlik politikası hâlâ yok (patch'ten devralındı): eski checkpoint dosyaları
  birikir. Ayrı iş olarak not edildi.
- `final Blends` gibi bir klasör **hem** döngü kökünün altında **hem** ayrı yazılıyorsa üst kök
  yeterlidir (iç içe kökler tekilleştirilir); bu bilinçli bir tercihtir.
