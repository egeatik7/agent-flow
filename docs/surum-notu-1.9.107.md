# Sürüm notu — 1.9.107 (ZIP kütüphanesi: JSON tuvaller, ZIP grupları)

**Kaynak paket**: `Nubbo_ZIP_Kutuphane_Final_1.9.105 (1)\Nubbo_ZIP_Kutuphane_1.9.105.patch`
(SHA256 `061226A6…`). Paketin bildirdiği taban **c402ac8 / 1.9.104**; bizim ağacımız 1.9.106'ydı.
**Bu nedenle dosya adı 1.9.105 dese de sürüm numaramız 1.9.107 olarak ilerletildi** (1.9.105 zaten
yayınlanmıştı ve içeriği farklıydı: "numaralı ekran görüntüsü" düzeltmesi).

## Uygulama ve çakışma çözümü

- `git apply --check` **üç yolda** çakıştı; çözüm:
  1. **22 dosya** zorlamadan temiz uygulandı (yeni ZIP modülleri, silinen eski kütüphane modülleri,
     `main.ts`, `App.tsx`, `src/types.ts`, stiller, README, testler).
  2. **`package.json` + `package-lock.json`**: `--3way` ile alındı; çakışma **yalnız sürüm satırlarıydı**
     (paket 1.9.105, biz 1.9.106) ve bizim numaralandırmamız korundu. Bağımlılık değişikliği temiz
     birleşti: **`sql.js` kaldırıldı → `adm-zip@0.6.1` eklendi** (`@types/sql.js` de gitti).
     `npm install` çalıştırıldı: `adm-zip` kurulu ✓, `sql.js` kaldırıldı ✓.
  3. **`docs/surum-notu-1.9.105.md` bilinçli olarak atlandı**: o sürümü biz zaten yayınladık ve içeriği
     farklı; paketin kendi sürüm notu bu belgeye ve `docs/zip-tuvaller.md`'ye taşındı (geçmiş silinmedi).
- **Uygulanan dosya listesi doğrulandı:** paketin `DEGISEN_DOSYALAR.txt` listesindeki her yol, ağaçta
  beklenen durumda (A/M/D) — tek istisna yukarıdaki bilinçli atlama. Yeni modüller var, eskiler yok:
  `zip-container/zip-canvas-document/zip-library-storage/zip-library-api/zip-workspace/ZipCanvasLibrary.tsx`
  ✓; `library-storage/library-database/workspace-store/CanvasLibrary.tsx` silindi ✓.

## Paketin getirdikleri (özet)

- **Windows kütüphanesi**: gerçek klasör + **ZIP grupları** + ZIP içinde **ayrı JSON tuvaller**.
- Yalnız **Tuvaller / Arşiv**; ayrı otomasyon kaydı, SQLite, katalog, otomasyon editörü ve eski göç
  kodları **kaldırıldı**. Eski kütüphaneye göç yapılmaz; yeni varsayılan konum **Belgeler/Nubbo/Kütüphane**.
- Grup sağ tık → **Otomasyon olarak aç**: JSON sırası (üstten alta) soldan sağa çalışma sekmeleri olur.
- Sabit `canvasId`/kimlik/ZIP adı çakışmaları: **Farklı Kaydet** ve ZIP'i kopya olarak içe aktarma ayrı
  kimlik oluşturur; yeni sürüm JSON aynı kimlikle mevcut kaydı **sessizce ezemez**.
- Çalışma taslakları otomatik kaydedilir; **ZIP dosyaları yalnız açık kullanıcı işlemlerinde yazılır**
  (otomatik kayıt ZIP'leri tekrar tekrar açıp taramaz).
- Ctrl/Shift, kutu seçimi ve Delete/sağ tık/toplu Sil; **aynı ZIP'te çoklu JSON tek atomik yazımla**
  silinir; açık çalışma içerikleri korunur. Bozuk ZIP görünür hata olarak listelenir; kurtarma taslakları
  **Aç / Sil** ile erişilebilir. Tablet izleme ZIP gruplarını ve iki bölümü gösterir.
- Geçersiz katalog testleri ve eski bileşenler/CSS kaldırıldı; bağımsız koşul/çalıştırma/arayüz
  regression testleri yeni yapıya uyarlandı. **Bizim önceki düzeltmelerimiz korunuyor** (koşul tek geçiş +
  koşul modeli, yerel sohbet, `[yerel]`/`[API]` etiketi, zamanlayıcı geri sayımı, numaralı ekran görüntüsü,
  kare-önce-UIA sırası — `electron/agent.ts` ve `a11y/screen.ps1` bu pakette değişmedi).

## Doğrulama (bu derlemede, Windows'ta koşuldu)

- `typecheck` ✓ (üç proje) · **Vitest 106 dosya / 811 geçti / 0 kırmızı** ✓ — ayrıca **iki kez üst üste**
  0 kırmızı (aşağıdaki kararsızlık notu).
- `npm run test:all` ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20, stability 40
  (+9 atlandı), lock 1; **hepsi 0 kırmızı**.
- **On iki PS 5.1 harness'i** exit 0 ✓ (yeni `test-scan-frame.ps1` dahil).
- Paketin dosya listesi ile ağaçtaki değişiklik **1:1** doğrulandı (yalnız bilinçli atlanan sürüm notu).

## Notlar / sınırlar (dürüst)

- **Bir kararsızlık görüldü:** ilk tam vitest koşusunda paketin yeni testi
  `tests/zip-library-storage.test.ts` ("saves one independent JSON per canvas…") **1 kez kırmızı** verdi;
  tek başına **26/26 geçiyor** ve sonraki iki tam koşu **0 kırmızı**. Yani ürün hatası değil, yeni ZIP
  testlerinde **paralel/ortak dosya yolu çakışması** gibi görünen bir kararsızlık. **Düzeltilmedi**
  (paketin kendi testi); not olarak bırakıldı.
- Paketin kendi notu: **Windows EXE üretilmemiş**, canlı masaüstü/native diyalog ve tablet görsel testi
  yapılmamış (bu derlemede `pack:win` ile EXE üretildi ve masaüstüne kopyalandı).
- Bilinçli tasarım: **iç içe ZIP grubu yok**, grup içi sıra Yukarı/Aşağı taşı ile; **birden çok ZIP silme
  sırayla** uygulanır ve sonraki dosyada hata olursa önceki tamamlanmış silmeler **geri alınmaz**.
- 1.9.98–1.9.106 notlarındaki diğer açık kalemler değişmedi (typeText'in korumalı dalı, Yap `allowCode`
  varsayılanı, ONNX hatasının görünmemesi, izin kapsamı, yerel model anahtarı, exe damgası, canlı masaüstü
  testleri).
