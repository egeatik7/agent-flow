# Sürüm notu — 1.9.112 (telefonda yalnız bilgi kartı)

**Kaynak paket**: `Nubbo_Telefon_Karti_1.9.110\Nubbo_Telefon_Karti_1.9.110.patch`
(SHA256 `85290077…`). Paketin tabanı **3d71b3b / 1.9.109**; bizim ağaç **1.9.111**'di, bu yüzden sürüm
**1.9.112** olarak ilerletildi (paket adı 1.9.110 dese de o sürümü biz farklı içerikle yayınlamıştık).

## Çakışma çözümü

- `git apply --check` **üç yolda** çakıştı; çözüm: 16 dosya zorlamadan temiz uygulandı; `package.json` +
  `package-lock.json` `--3way` ile alındı ve çakışma **yalnız sürüm satırlarıydı** (bizim numaralandırma
  korundu); **`docs/surum-notu-1.9.110.md` bilinçli atlandı** (o sürüm bizim; paketin özeti bu belgeye taşındı).
- Not: paket, 1.9.108'de eklediğimiz `tests/zip-library-path.test.ts` dosyasını da günceller (temiz birleşti).

## Getirdikleri

- **Telefon bağlanınca yalnız dikey bilgi kartı** görünür: tuval, kütüphane, günlük, node kontrolleri ve
  Kapat düğmesi **oluşturulmaz**; **tablet normal izleyiciyi korur**. Kart; metin, yöntem, döngü, geri
  sayım ve kurtarma bilgisini **canlı** alır; bağlantı kesilirse "son alınan bilgi" olduğu belirtilir.
- Kesin cihaz ayrımı ve telefonda **dikey yön kilidi** Android tarafında bildirilir (PC arayüzü ekran
  sınıfını öğrenir). **Bunun için APK güncellemesi gerekir**; mevcut APK'da yalnız kısa-kenar yedek
  algılaması vardır. Paket **kaynak patch'tir**; imzalı APK/PC EXE içermez (Android SDK/anahtar bu
  ortamda yok — biz de APK derlemedik).
- Yeni izin, JS/native köprü veya PC'ye otomasyon komutu **eklenmedi**.

## Doğrulama (bu derlemede)

- `typecheck` ✓ · **Vitest 112 dosya / 842 geçti / 0 kırmızı** ✓ · **beş Node paketi + `test:lock`** hepsi
  0 kırmızı (keys 3, input 7, recovery 27+12, targeting 20, stability 40+9, lock 1) · `git diff --check` temiz.
- Yeni testler (paketten): `phone-card-only`, `phone-hud-relay`, `phone-viewer-controls` ✓.

## Sınırlar

- **Android Java/APK derlemesi yapılmadı** (SDK + imzalama anahtarı yok) → telefonda **kurulu APK
  güncellenmeden** yeni dikey kilit davranışı görülmez; PC tarafı hazır.
- **Fiziksel telefon/tablet, görsel ekran görüntüsü ve canlı Windows EXE testi yapılmadı** (paketin kendi
  notu da bunu söylüyor).
- 1.9.110/1.9.111'den kalan açık: **ekran görüntüsünün Qwen'e gitmemesi** bu sürümde de kapatılmadı
  (sıradaki iş: isteğe görüntü eklenip eklenmediğini ve sebebini günlüğe yazmak).
