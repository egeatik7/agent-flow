# Sürüm notu — 1.9.109 (kullanıcı seçimi de artık kilitleyemez)

**Kaynak**: 1.9.108'in ardından kapatılan kalan açık. 1.9.108 varsayılan/kayıtlı yol için güvenli seçim
yapıyordu; ama kullanıcı **arayüzden** korumalı bir klasör (ör. Belgeler) seçerse `library:manage` akışı
yine `mkdirSync` deneyecek ve **uygulama kilitlenebilecekti**.

## Değişiklik (`electron/main.ts`)

- `protectedRoots()` + `unsafeLibraryPath()` yardımcıları: bir yol **korumalı VE henüz yok** ise tehlikeli
  sayılır (ölçüm: bu durumda `mkdirSync` süresiz bekliyor).
- `library:manage` → **open** akışında, seçilen klasör yükleme denenmeden önce kontrol edilir ve
  tehlikeliyse **açık Türkçe hata** verilir:
  *"… Windows Denetimli klasör erişimi kapsamında ve henüz yok; orada klasör açmak uygulamayı kilitleyebilir.
  Korumasız bir klasör seç (ör. `<profil>\NubboKutuphane`) ya da … Denetimli klasör erişimi altında bu
  uygulamaya izin ver."* — yani hata vermek, donmak yerine.
- Klasör zaten **varsa** (korumalı olsa bile) seçim normal çalışır: okumak güvenlidir.

## Doğrulama

- `tests/zip-library-path.test.ts` **7/7** ✓ — yeni test, `unsafeLibraryPath`'in kullandığı bileşimi ölçer:
  korumalı+yok → tehlikeli (kilitlenme senaryosu), korumalı+var → güvenli, korumasız → güvenli.
- `typecheck` ✓ · **Vitest 107 dosya / 818 geçti / 0 kırmızı** ✓ · **beş Node paketi + `test:lock`** hepsi
  0 kırmızı (keys 3, input 7, recovery 27+12, targeting 20, stability 40+9, lock 1).

## Sınırlar

- Canlı masaüstünde diyalogla seçim denenmedi (kanıt: saf kural testi + `mkdirSync` ölçümü).
- Denetimli klasör erişimi **açık** kaldığı sürece Belgeler/Masaüstü gibi yerler Nubbo için yazılamaz;
  kütüphane korumasız bir klasörde kalmalı ya da uygulamaya izin verilmelidir (ayrıntı: 1.9.108 notu).
