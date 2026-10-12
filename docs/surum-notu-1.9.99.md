# Sürüm notu — 1.9.99 (kütüphane kimliği, toplu işlemler ve oturum kaydı)

**Kaynak**: `Nubbo_Kutuphane_Son_Patch` → **`01_Kutuphane_Artimli.patch`** (SHA256 `887780cc…`).
Kurulum kuralı "tek patch seç" diyor: `01` **önceki Koşul/yöntem paketi uygulanmışsa** (`4df4496`),
`02` ise özgün 1.9.93 içindir. Biz Koşul/yöntem paketini uygulamış (1.9.97) ve üstüne Tur 4 koşul
değişikliğini (1.9.98) eklemiş durumdayız → **doğru seçim `01`**; `02` bilinçli olarak **uygulanmadı**.

## Uygulama ve çakışma çözümü

- Düz `git apply --check` **iki dosyada** çakıştı: `electron/main.ts`, `src/App.tsx` — ikisi de bizim
  Tur 3/Tur 4'te değiştirdiğimiz kayıt yolları. Çakışmayan **22 dosya temiz uygulandı**; çakışan ikisi
  `git apply --3way` ile alınıp **elle birleştirildi** (ağaçta **hiç çakışma işareti kalmadı** ✓).
- **`electron/main.ts` birleşimi:** paketin yeni sözleşmesi (katalogu **yalnız pencere kaydı** yazar;
  reddedilen kayıtta `unpublishedCatalogSession` ile **eski yayınlanmış taban** korunur) + bizim Tur 3
  sözleşmemiz (katalog yazılamazsa **oturum yine yazılır** ve hata `{ conflict, libraryError }` olarak
  **döner**, yükseltilmez) birlikte çalışıyor.
- **`src/App.tsx` birleşimi:** paketin `saveCanvases(snapshot, { catalog: requireCatalog })` çağrısı
  (otomatik taslak/oturum yazımları katalogu yayınlamaz; **açık** kütüphane işlemi yayınlamak zorunda)
  + bizim dürüstlük davranışı (katalog yazılamazsa **başarı mesajı yok**, kayıt tabanı ilerlemez, sekme
  kirli kalır) birlikte korundu; `requireCatalog` işleminde katalog yazılamazsa işlem **tamamlanmış
  sayılmaz** (durum hata, işlem iptal, taslak korunur).

## Paketin getirdikleri

1. **Çoklu seçim ve toplu silme** ✓: kutu/Ctrl/Shift seçimi → sağ tık, seçim düğmesi ve Delete ile **tek
   batch silme**; silinen tuvallere ait **otomasyon bağlantıları temizlenir**, açık çalışma sekmeleri
   taslak olarak kalır (`electron/library-delete.ts`).
2. **Kimlikli tuval export/import** ✓: aynı kimlik + aynı içerik → yeniden kullanım; farklı içerik →
   **çakışma** ve "Farklı Kaydet" (`electron/canvas-identity.ts`, `electron/canvas-file.ts`,
   `src/components/CanvasImportConflictDialog.tsx`). Otomasyon dosyalarındaki tuval kimlikleri korunur;
   importta otomasyonun grup kaydı **yeni grup** olur.
3. **Katalog yazım disiplini** ✓: otomatik tab/taslak/başlangıç kayıtları katalog dosyasına **dokunmaz**
   (`WorkspaceWriter`'a eklenen `'session'`), açık kütüphane kaydı ayrı yoldur; reddedilen katalog
   kaydında ve IO hatasında **eski başarılı taban korunur**, taslak yeniden açılışta kaybolmaz.
4. **Kütüphane tutarlılığı** ✓: legacy karma klasör görünürlüğü, aynı adla klasör taşıma ve bölüm
   uyuşmazlığı düzeltildi; kaydedilmemiş otomasyon taslak satırı karma toplu silmede ayrı değerlendirilir;
   modern katalogda aynı kimlikte bozuk kayıt varsa **otomatik yeni kimlik verilmez**, veri korunarak hata
   gösterilir.
5. Eski düz `nodes/edges` JSON'ları desteklenmeye devam eder; yeni biçimde `canvasId`/`format`/`name`
   metadata eklenir (sayısal `revision` alanı **eklenmedi**).

## Doğrulama (bu derlemede, Windows'ta koşuldu)

- `typecheck` ✓ (üç proje) · **Vitest 115 dosya / 905 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.98 tabanı 113/871 → **+2 dosya / +34 test**).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- **Önceki düzeltmelerimiz korundu** (ölçüldü): `newTally`/`stepFailures` (koşu sayacı dürüstlüğü),
  `stableStartId` (Başlangıç kimliği), `WORD_CANDIDATE_LIMIT` (aday sınırı), kilit sahipliği yeniden
  edinme, `libraryError`/`catalogFailureRef` (sahte başarı yok) ve Tur 4 koşul sözleşmesi
  ("koşul her zaman metin modeline sorar", "Ekrandan Seç" kaldırıldı, "Eski seçimi temizle").
- **Paketin kaynak kopyasıyla karşılaştırma:** bizim dokunmadığımız **34 kaynak dosya birebir aynı** ✓;
  farklı çıkan 14 dosyanın tamamı bizim Tur 3/Tur 4 değişikliklerimizi taşıyor ✓.
- **Birleşik sözleşme kararı ve test uyarlaması:** paketin `workspace-main.test.ts` testi "katalog IO
  hatası **yükseltilir**" bekliyordu; birleşik sözleşmede hata yükseltilmez, `{ libraryError }` döner
  (paketin değerli iddiası olan *düzenlenen taslağın oturumda korunması* aynen ölçülmeye devam ediyor).
  Bu test bilinçli olarak birleşik sözleşmeye çevrildi ve gerekçesi yorumda yazılı.
  Bizim `tests/fix-tur3-persistence.test.ts` VM bağlamına yeni `unpublishedCatalogSession` eklendi.

## Sınırlar

- Gerçek **Windows masaüstü, canlı UIA/OCR, iki süreçli yarış ve fiziksel tablet** bu derlemede de
  sınanmadı; testler mock okuyucular, `vm`/react-test-renderer düzeyinde.
- Paketin kendi notu: **EXE üretilmemiş ve canlı Windows denenmemişti**; bu derlemede `pack:win` ile EXE
  üretildi ve masaüstüne kopyalandı, ama **canlı masaüstü/tablet testi yine yapılmadı**.
- 1.9.98 notundaki "bu sürüme alınmayan" kalemler (typeText'in korumalı dalı, Yap `allowCode` varsayılanı,
  ONNX hatasının görünmemesi, izin kapsamı, yerel model anahtarı, profil klasörü çakışması, exe damgası)
  **hâlâ açık**.
