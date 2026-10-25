# Nubbo 1.9.178 — Harness kaldırıldı, Koşul yokluk geçişi düzeltildi

Taban: GitHub main 1.9.177 (`e0cc6e0`).

## Harici kurtarma kaldırıldı

DeepSeek Harness seçimi, program seçme/bağlantı testi arayüzü, preload/IPC çağrıları, ACP süreci, Harness'a özel HTTP MCP sunucusu ve tam kontrol yetki genişletmesi kaldırıldı. Dört üretim modülü ve bunlara özel beş test dosyası ile süreç fixture'ı silindi. Nubbo'nun kendi kurtarma ajanı, Yap node'u ve genel CLI/test araç katmanı korunur. Kurulu DeepSeek uygulamasına veya onun profillerine müdahale edilmez.

Eski ayarlarda provider=harness ise dış programa ait ayarlar normalizasyonda atılır ve kurtarma kapalı taşınır. Yerleşik ajan kendiliğinden etkinleştirilmez; Kurtarma sekmesinden model/bağımsız API anahtarı kontrol edilerek açılıp kaydedilebilir. Daha önce yerleşik ajan seçiliyse etkinlik, anahtar, model sırası, talimatlar ve yetkiler korunur. Ayar yaması tekrar normalizasyondan geçer; eski alanlar yeniden yazılmaz. Genel API anahtarı kurtarma anahtarı yerine kopyalanmaz.

Geçmiş Harness raporları silinmez; mevcut rapor ekranı ayrıntılarını göstermeye devam eder. Eski sürüm notları tarihçe olarak bırakılır; kullanılabilir özellik tarifleri 1.9.178'e göre değerlendirilmelidir.

## Koşul düzeltmesi

Doğrulanan hata: UIA listesindeki yokluk, OCR'a sıra gelmeden bütün ekran için kesin sonuç sayılıyordu. Blender veya çizilerek oluşturulan bir arayüzde görünen yazı UIA'da olmayıp OCR'da okunabilir. Bu durumda görünen hedef için yanlış 'yok' dalı seçilebiliyordu.

Yeni davranış:

- Güncel bir öğeye/sayaca dayanan kanıtlı UIA kararı tek okumada sonuçlanmaya devam eder.
- Kanıt numarası olmadan UIA'nın bildirdiği yokluk (varlık sorusuna false veya yokluk sorusuna true) doğrudan sonuçlandırılmaz; Windows + ONNX OCR da okunur.
- OCR gerçek öğeyi görürse bu kanıt değerlendirilir: görünen hedef 'var' olabilir; kaybolma sorusundaki görünen Loading etiketi 'hayır' olabilir.
- İki okuyucunun yokluk yorumları zıt ise o gözlemden dal seçilmez; mevcut sınırlı yeniden gözlem/kurtarma yolu kullanılır.
- UIA kararsız kaldığında OCR'ın kendi geçerli kararı korunur. Okuyucu/model hatası otomatik yokluk sayılmaz.
- Mevcut model güven eşikleri, bağımsız ikinci görüş, sayısal kanıt doğrulaması, Durdur ve salt okunur koşul davranışı değiştirilmez.

Yeni dört davranış testi; UIA'da olmayan OCR yazısını bulma, görünür Loading için yanlış kaybolma onayını reddetme, iki okuyucuda yokluk ve OCR kararsızlığını kapsar. Üç kaldırma/migrasyon testi eski model ve anahtarın korunmasını, yerleşik ajanın etkinliğini ve arayüzden yeniden açılıp kaydedilmesini kapsar.

## Doğrulama ve kapsam

İlgili 10 dosyada 162 test geçti. Üç TypeScript projesi ve renderer/main derlemesi geçti. Beş Node regresyon dosyasında 67 test geçti, Windows'a özgü 21 test atlandı, başarısızlık yok. Tam test paketi ve değişmemiş taban karşılaştırması teslim paketinin DOGRULAMA.md dosyasındadır.

Bu ortamda gerçek Windows masaüstü/OCR/model çalıştırılmadı. Kullanıcının son sorunlu Koşul node'una ait güncel günlük/ekran örneği verilmediği için o sorunun kesinlikle yalnız bu hatadan kaynaklandığı söylenemez. Düzeltme, kodda doğrulanan erken UIA yokluk kararını giderir; gerçek koşu ayrıca denenmelidir. Node tarifi, okuyucunun yazıyı hiç okuyamaması, yanlış uygulama bağlamı ve modelin semantik değerlendirmesi ayrı nedenler olabilir.

Yeni bağımlılık yok. Giriş/çıkış klasör sistemi, döngü ZIP'leri, tur/devam düğmesi önerileri bu patch'te değiştirilmedi. Hazır Windows EXE üretilmedi.

## Paket doğrulaması (yerel, Windows)

Kaynak paket: `C:\Users\ASUS TUF\Downloads\Nubbo-Harness-Kaldirma-Kosul-Patch-1.9.178\Nubbo-1.9.178`
(`nubbo-1.9.178.patch`, `manifest.json`, `deleted-files.txt`, `replacement-files/`, `verification/`).

- Taban `e0cc6e0` (1.9.177) temizdi; `git apply --reverse --check` **başarısız** (uygulanmamış),
  `git apply --check` **geçti**, uygulama zorlamasız yapıldı; `git diff --check` **temiz**.
- **Silme doğrulaması:** `deleted-files.txt`'teki **10 dosya** (4 `electron/harness-*`, 5 Harness testi,
  `tests/fixtures/harness-acp.cjs`) gerçekten silindi; kaynakta (`*.ts/tsx/cjs`) Harness'a kalan
  referans yok ve derleme sonrası `dist-electron` içinde `harness-*.js` **yok** (build:main dizini
  sıfırdan üretir).
- **Hash doğrulaması:** manifestteki 26 yolun tamamı doğrulandı — 16 dosya LF/CRLF SHA-256 ile
  birebir, 10 dosya yok. Sürüm 1.9.178 (`package.json` + `package-lock.json`). Yeni bağımlılık yok.

## Bu makinede ölçülen geçit (Windows)

- `npm run typecheck` ✓ (üç proje).
- İlgili **10 dosya: 162/162** ✓ (`condition-decision`, `condition-target`, `condition-recovery`,
  `recovery`, `recovery-runtime`, `recovery-ui`, `recovery-handoff`, `recovery-removal`,
  `fix-tur4-condition`, `fix-tur6-condition-model`).
- Tam Vitest, `--maxWorkers=2` → **206 dosya / 1614 test yeşil** (0 başarısız, 0 atlanan).
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 → **98 geçti, 21 atlandı, 0 başarısız**.
- Yedi PowerShell **5.1** harness'ı `exit=0` (`test-screen` PARTIAL notu eskiden beri var).
- `npm run build:electron` ✓.

### Bu makinedeki kararsız test (yeni değil)

Varsayılan işçi sayısıyla tam taramada her koşuda **1 rastgele** hata görüldü; hepsi Windows
`EPERM: rename … .tmp -> ….zip` ya da süre aşımı türünden:
`zip-library-storage` (2 koşu, farklı iki test) ve — **patch uygulanmadan, 1.9.177 tabanında** —
`zip-main-persistence` ile `harness-recovery` (her koşuda 1 hata). Bu dosyalar tek başına ve
`--maxWorkers=2` ile koşulduğunda **geçiyor**. `electron/zip-library-storage.ts` bu patch'te
değişmedi. Sonuç: yük/antivirüs kaynaklı bilinen kararsızlık; bu patch'in regresyonu değil, ama
tam taramanın varsayılan işçi sayısıyla `%100 yeşil` olmadığı da gizlenmiyor.

## Sınırlar (dürüst)

- **Gerçek Windows/OCR/model koşusu yapılmadı.** Koşul düzeltmesi gerçek Blender/Hunyuan ekranında
  denenmedi; kullanıcının sorunlu node'una ait günlük/ekran örneği yok. "Kesin düzeldi" denmiyor.
  Aynı node gerçek akışta tekrar denenmeli; sürerse koşul metni + güncel tarama + model yanıtı
  üzerinden araştırılmalı.
- Harness kaldırıldı: 1.9.175–1.9.177'teki DeepSeek Harness kurtarma yolu artık yok. Geri gerekirse
  `v1.9.175`…`v1.9.177` etiketlerinde duruyor. Kurulu DeepSeek uygulamasına/profillerine dokunulmadı.
- Eski `provider: harness` ayarı kurtarmayı **kapalı** taşır; Nubbo kendi ajanını kendiliğinden
  açmaz. Kullanmak için Kurtarma sekmesinden model + bağımsız API anahtarıyla açıp kaydetmek gerekir.
- Paketin kendi Linux ortamında tam tarama kırmızıydı (14 hata + 1 yükleme hatası, temiz tabanla
  aynı). Burada iki işçiyle yeşil.

## EXE

`Nubbo-1.9.178.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.178.exe` · SHA256 `BEKLENIYOR`.
