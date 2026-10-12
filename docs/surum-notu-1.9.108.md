# Sürüm notu — 1.9.108 (kütüphane klasörü artık uygulamayı DONDUREMEZ)

**Kaynak**: kullanıcının bildirimi — *"nubbo 1.9.107 açılmıyor, arayüz yükleniyor adımında takılı kalıyor;
kütüphane yolunu sildim, şimdi de Windows Defender uyarı verdi."*

## Kök neden (ölçüldü, tahmin değil)

1. **Windows Defender "Denetimli klasör erişimi" (fidye yazılımı koruması) açık:** `Get-MpPreference`
   → `EnableControlledFolderAccess = 1`.
2. Defender olay günlüğü, kullanıcının üç açma denemesiyle **birebir aynı saniyelerde** engellemeyi yazıyor:
   `id=1123` @ **21:45:51, 21:46:55, 21:47:54** →
   *"…\Temp\…\Nubbo Agent Studio.exe öğesinin **%userprofile%\Documents** öğesini değiştirmesi Denetimli
   klasör erişimi tarafından engellendi."*
3. ZIP kütüphanesinin varsayılan yolu **`Belgeler\Nubbo\Kütüphane`** (`main.ts:1222`) — yani korumalı klasör.
4. **Asılan tam çağrı:** `fs.mkdirSync("…\Documents\Nubbo\Kütüphane", { recursive: true })`. Adım adım
   ölçüm (her sistem çağrısından önce günlüğe yazan Node probu, 30 sn korumalı) şunu gösterdi: `mkdirSync`
   bu yolda **süresiz bekliyor — hata bile döndürmüyor**. Aynı anda korumasız bir yolda aynı kütüphane
   yüklemesi **42 ms**'de bitiyor.
5. Sonuç: açılışta kütüphane yüklenirken ana süreç bekliyor → renderer "arayüz yükleniyor"da kalıyor.
   Klasörü silmek çözüm değildi, çünkü uygulama onu **yeniden oluşturmaya** çalışıyordu ve yine bekliyordu.

**Defender bir virüs bulmadı**; uyarı "Denetimli klasör erişimi engelledi" bildirimiydi.

## Yapılan düzeltme

- **Yeni saf modül `electron/library-path.ts`**: kütüphane klasörünü seçer ama **korumalı ve henüz var
  olmayan** bir klasörü asla oluşturmaya çalışmaz:
  - kayıtlı ayar (`zipLibraryPath`) varsa tartışmasız o kullanılır;
  - varsayılan `Belgeler\Nubbo\Kütüphane` **zaten varsa** kullanılır (okumak güvenli, `mkdir` çağrılmaz);
  - **yoksa ve korumalı bir kökün altındaysa** korumasız `%USERPROFILE%\NubboKutuphane` klasörüne düşülür,
    bu seçim ayara yazılır ve günlüğe **ne yapılacağı yazılır** (klasör seç ya da Defender'da izin ver).
  Korumalı kökler: Belgeler, Masaüstü, Resimler, Videolar, Müzik, Favorites.
- **Okunamayan kütüphane artık arayüzü kilitlemez:** `loadCanvases()` içindeki yükleme `try/catch` içinde;
  hata olursa günlüğe yazılır ve **boş kütüphaneyle devam edilir** (arayüz açılır).
- **Kullanıcının hemen çalışması için** (bu sürümden önce): `zipLibraryPath` ayarı
  `C:\Users\ASUS TUF\NubboKutuphane` olarak ayarlandı (yedek: `config.json.bak-<zaman>`); bu yolda kütüphane
  yüklemesi **42 ms** — uygulama açılıyor.

## Doğrulama

- Yeni `tests/zip-library-path.test.ts` **6/6** ✓ — kayıtlı ayar kazanır; var olan korumalı varsayılan
  kullanılır; **korumalı + yok → korumasız profil klasörüne düşer**; korumalı olmayan varsayılan kullanılır;
  kök eşleşmesi sınır duyarlı ve harf duyarsız (`…\Documents2` korumalı sayılmaz); boşluklu ayar yok sayılır.
- Ölçüm kanıtı: asılan çağrının `mkdirSync` olduğu adım adım probla bulundu; korumasız yolda `load()` 42 ms.
- `typecheck` ✓ · **Vitest 107 dosya / 817 geçti / 0 kırmızı** ✓ · **beş Node paketi + `test:lock`** hepsi
  0 kırmızı (keys 3, input 7, recovery 27+12, targeting 20, stability 40+9, lock 1) · **on iki PS 5.1
  harness'i** exit 0 ✓.

## Kullanıcı için kalıcı seçenekler

1. **Kütüphane korumasız bir klasörde kalsın (önerilen, hiçbir izin gerekmez):** şu an
   `C:\Users\ASUS TUF\NubboKutuphane`. Uygulama içinden **Ayarlar/Kütüphane → klasör seç** ile istediğin
   (korumasız) yeri seçebilirsin.
2. **Belgeler altında kalsın istiyorsan:** Windows Güvenliği → Virüs ve tehdit koruması → Fidye yazılımı
   koruması → **Denetimli klasör erişimi** → *Uygulamaya izin ver* ile Nubbo'yu ekle. **Uyarı:** taşınabilir
   (`Nubbo-1.9.x.exe`) sürüm her açılışta **rastgele bir %TEMP% klasörüne** açıldığı için izin listesi her
   sefer geçersiz kalır; bu yüzden Belgeler'i kullanmak istiyorsan **sabit klasörden çalışan** (unpacked)
   kurulumu izin listesine eklemek gerekir.
3. İstersen Denetimli klasör erişimini kapatabilirsin (güvenlik azalır; önerilmez).

## Sınırlar

- Canlı masaüstünde uçtan uca gözle test edilmedi; kanıt `mkdirSync` ölçümü + birim testleri düzeyinde.
- **Kullanıcının eski kütüphane klasörü silinmiş durumda** (kendisi sildi): eski katalog/ZIP kütüphanesi
  geri getirilmedi. `Masaüstü\Plug&Play` içindeki **8 ZIP** yerinde duruyor; kütüphaneye *ZIP'i içe aktar*
  ile alınabilir.
- Önceki notlardaki diğer açık kalemler değişmedi.
