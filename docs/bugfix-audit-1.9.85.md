# Bağımsız audit düzeltmeleri — 1.9.85

Taban: `1cb44929754fa8935c4424b53f1c8e77a55fba72`. Uygulama sürümü değiştirilmez.

## Kapsam

| Rapor maddesi | Düzeltme |
|---|---|
| A1, Q1, Q2 | Model denemeleri varsayılan en fazla 256 tam tur / 15 dakika; devam eden tek isteğin kendi timeout'u korunur. 413/415 ve açık bellek/istek biçimi hataları kalıcı ret. Metin içerik dizisi ve string hata yanıtı desteklenir. Geçici 429/503 ilk hatada durdurulmaz. |
| A2, A3 | Bakiye/Quota hedef metni kesinti sayılmaz. Model/bağlantı katmanı altyapı hatasını tipli `serviceFailure` işaretiyle taşır; öğeye özel farklı hedef hataları atlanmaya devam eder. Aynı metinli ardışık hata koruması korunur. |
| A4 | Döngü üyesinin kutu dışına çıkan oku paket çıkışı olarak kabul edilmez; kullanıcıya `bitti` çıkışı açıklanır. |
| A5, Q6 | Kutu çağrıları bulunduğu zincirin bütçesine dahil edilir; her meşru liste turunun kendi bütçesi korunur. Paket ve elle paket içine başlatma yollarında debug aktarılır. |
| B1 | Worker'ın tıklama uyarısı bridge'den döner ve ajan logunda görünür. Kullanıcının uyarıyla devam etme davranışı korunur. |
| B2 | Fare hareketi `sent:false/inputKind:move`, gerçek tıklama/yazı/tuş girdisi `sent:true`; recovery açık `sent:false` kanıtını kullanır. Gönderildiği bilinmeyen eski sonuçlar temkinli kabul edilir; gerçek girdinin kör tekrarı engellenir. |
| B3 | Merge uygulama sonucunda silinen node kimlikleri, korunmuş kutular ve açıklama bulunur. |
| B4 | Üst seviyede bağlantısız anlık false sonucu `incomplete:true`, uyarı logu ve başarılı sayılmayan koşu sonucu verir; öğe hatası uydurulmaz. Paketlerin kayıtlı çıkış/legacy bağlantı semantiği korunur. |
| B5, C2 | Fotoğraf yazma hataları loglanır. Ekran dosyaları yalnız sahip olunan ad deseninde temizlenir; son çıktı okunabilir kalır, eski dosyalar 100 dosya / 100 MB / 24 saat sınırlarıyla ve başlangıçta temizlenir. Sembolik bağlantılar takip edilmez. |
| C1 | İç kontrol karakterli anahtar reddedilir; API hata/log/voice metninde bilinen anahtar maskelenir. Ayar kaydı da anahtarı doğrular. |
| C3 | JSON koordinatları varsayılan prompt sözleşmesine göre 0–1000; 0–1 kullanan özel prompt yanıtı açık `coordinate_unit:"normalized"` vermeli. |
| C4 | Görsel beyanı kapalı yerel modele resim gönderilmez. Yazı alternatifi bulunan çağrı yazıyla devam edebilir; yalnız görsel gerektiren çağrı yedek modele geçer. |
| D1 | LLM prompt/sıralama taslağı mevcut ayar taslağında tutulur; ilgisiz ayar değişimi ve panel sekmesi değişimi taslağı silmez. Kaydet düğmesi korunur. |
| D2–D4 | Döngü menüsü Escape/dış tık/disabled durumunda kapanır; tuval değişiminde eski menü/palet ve geçici hareketler temizlenir; boş liste satırı düzenlenebilir. |
| D5, D6 | Süre yazarken kırpılmaz; blur/Enter'da sınırlandırılır. Bilinçli maxSteps=500 korunur. |
| D7 | Kaydedilmemiş tuval raporu `tab:<id>` ile ayrılır; canvasId'siz eski raporlar başka tuvalin node'larına dağıtılmaz. Eski raporlar genel rapor panelinde durur. |
| E1–E3 | Eksik os import'u tamamlandı; dirty damgasında SHA doğru karşılaştırılır; bütün profil betikleri uygulamayla aynı normalizasyonu kullanır. |
| E4 | Senaryo beklentileri özel koşu temp kökü/test-artifacts ile sınırlı; dış yol ve sembolik bağlantı reddedilir. Beklenmedik çıktı silinmez, kanıt kopyası ve aslı korunur. `{{temp}}` artık koşuya ayrılan alt klasördür. |
| E5 | Okunamayan/boş/başarısız idle ölçümü `free:false`, çıkış 4; negatif eşik de reddedilir. |
| Q7, Q8, Q10, Q11, Q12 | Legacy graph:save normalize eder; öğe açma hatası görünür; timeout=0 açıkça reddedilir; geç gelen görüntü güncel rampayla boyanır; modal/scanner açıkken grafik değiştiren kısayollar engellenir. |
| N1–N4 | Çalıştırma kilidi ilk await öncesinde alınır; aynı grafik snapshot'ı denetlenip çalıştırılır. İptal/kapanışta kilit temizlenir. Sürücü kökü korunur; dinamik klasörlerin eski liste önbelleği denetlenmez; eksik-yol modalında Delete engellenir. |

Q5 önceki kayıt yamasıyla zaten ele alınmıştı. Q3/Q4 için canlı Windows yanlışı kanıtlanmamıştı; bu patch onlara yeni güvenli-masaüstü ya da replay doğruluğu iddiası eklemez. Q9/Q13/Q14/Q15/Q16 ve iki çürütülmüş iddia işlev kusuru olarak değiştirilmedi.

## Kontrol

- 691 test geçti, 5 atlandı; 0 başarısız. Önceki toplam 635 geçen testti: 56 yeni regresyon testi eklendi.
- `npm run typecheck`, `npm run build`, `git diff --check` başarılı.
- Temiz taban üzerinde `git apply --check` ve gerçek uygulama/ters uygulama kontrolü başarılı.
- Gerçek Windows masaüstü, UAC, Ollama veya yayınlanmış EXE çalıştırılmadı. API/masaüstü testlerinde taklit bağımlılıklar kullanıldı.

## Patch uygulama

Repoda aşağıdaki komutları çalıştır:

```bash
git apply --check Nubbo_Bugfix_1.9.85.patch
git apply Nubbo_Bugfix_1.9.85.patch
npm test
npm run typecheck
npm run build
```

Taban farklıysa check hatası verir; zorla uygulama. Patch yeni yardımcı kaynakları ve regresyon testlerini içerir. Uygulandıktan sonra bu dosya `docs/bugfix-audit-1.9.85.md` olarak bulunur.
