# Nubbo 1.9.176 — Harness kurtarma hata düzeltmeleri

Taban: GitHub main `45562ad929841698f7ab279cebc2a6d882c29b24` (1.9.175).
Bu sürüm yalnız Harness hata düzeltmesidir; klasör ve iki ayrı üretim döngüsü yeniden değiştirilmez. Yeni bağımlılık yoktur.

## Düzeltilen senaryolar

| Senaryo | Eski davranış | Düzeltme |
| --- | --- | --- |
| Harness raporu kaydettiği halde ACP prompt yanıtını bitirmiyor | Sınırsız oturumda Nubbo sonsuza kadar bekleyebiliyordu | Kalıcı terminal rapor ayrı bir tamamlanma sinyali verir; oturum kapatılmadan akış sürmez |
| Başarısız node eski/kapalı bir pencereye bağlı, ajan tüm masaüstünü istiyor | Açıkça verilen boş pencere adı eski node hedefiyle değiştiriliyordu | Varsayılan pencere yalnız hem hwnd hem windowTitle verilmemişse eklenir |
| Executor hazırlığı hata veriyor | Hata kayıt/temizlik kapsamının dışında kalabiliyordu | Hazırlık kaydedilen kurtarma girişinden sonra try içinde yapılır |
| Uzun eylem pending döndü, ajan farklı kimlikle ikinci eylem/sonuç gönderiyor | İlk sonuç görülmeden yeni mutasyon kuyruğa girebiliyordu | Önce önceki mutasyon sonucu alınmalı; stop raporu için ayrı acil kontrol yolu vardır |
| HTTP araç yanıtı istemciye yazılmadan bağlantı kopuyor | Sonuç ve ekran erken teslim edilmiş sayılabiliyordu | Teslim işareti HTTP finish olayından sonra verilir; iptal edilen yanıt kanıt sayılmaz |
| Aynı operationId ve aynı alanlar farklı JSON alan sırasıyla gönderiliyor | Yanlışlıkla farklı işlem sayılabiliyordu | İmza alanları sıralanır; eski sonuç döner, eylem tekrar yürütülmez |
| Çok uzun oturumda sürekli bağlam/ekran okunuyor | Tamamlanmış okuma işleri sınırsız birikiyordu | Tüketilen son 64 okuma işi tutulur; işlem tekilleştirme kayıtları ve bekleyen sonuçlar korunur |
| POSIX Harness ana süreci çöküyor, alt süreç yaşamaya devam ediyor | Ana süreç kapanmış diye süreç grubu temizlenmiyordu | Sahip olunan süreç grubu ana süreçten bağımsız kapatılır; regresyon testi geçtir |
| Kapanış hata veriyor | MCP temizliği ve son rapor atlanabiliyordu | İki temizlik bağımsız denenir; doğrulanamayan kapanışta akış devam ettirilmez |

Windows taskkill beklemesi 4 saniye ile sınırlandı; gerekirse ana süreç için doğrudan sonlandırma denenir, ana süreç çıkışı 1.5 saniye içinde doğrulanamazsa hata verilir. Terminal rapordan sonraki sohbet parçaları kayıtlı ayrıntılı raporu değiştirmez.

## Korunan davranışlar

- Harness seçiliyken yerleşik kurtarma ajanına hiçbir otomatik geri dönüş yoktur.
- Varsayılan sınırsız kurtarma/otomatik devam ayarı korunur.
- Yap/Koşul/Paket/Döngü çalıştırma, yeni koşu açma ve iç içe kurtarma açılmaz.
- Mevcut döngü öğesiyle tek node çalıştırma ve gönderimi belirsiz node'u tekrarlamama kuralları korunur.
- Terminal karar için güncel ekran ve başarıyla kaydedilmiş ayrıntılı rapor gerekir.

## Doğrulama ve sınırlar

İlgili 9 test dosyası: 100/100 geçti; bunun 35'i Harness testidir ve 8 test bu sürümde eklendi. Üç TypeScript projesi typecheck ve renderer/main derlemesi geçti. Toplu test sonuçları patch paketinin DOGRULAMA.md dosyasındadır.

Buradaki süreç testleri gerçek bir yerel ACP fixture süreci ve HTTP MCP bağlantısıyla yürütülür; gerçek DeepSeek modeli veya Windows masaüstü kullanılmaz. Windows'ta kurulu Harness ile EXE/CMD/JS başlatma, UAC, durdurma ve gerçek uygulama işlemleri ayrıca denenmelidir. POSIX süreç grubu testi Windows'ta bilinçli olarak atlanır. Windows'ta ana süreç önceden çöktüğünde veya harici uygulama bağımsız süreç olarak ayrıldığında taskkill ile bütün alt süreçlerin kapandığı garanti edilmez; bu patch Windows Job Object gözetimi eklemez. Mevcut kullanıcı hakları dışında yönetici yetkisi vermez.

## Paket doğrulaması (yerel, Windows)

Kaynak paket: `C:\Users\ASUS TUF\Downloads\Nubbo-Harness-Bugfix-Patch-1.9.176\Nubbo-Harness-Bugfix-Patch-1.9.176`
(`nubbo-harness-1.9.176.patch`, `manifest.json`, `replacement-files/`, `verification/`).

- Taban `45562ad` (1.9.175) temizdi; `git apply --reverse --check` **başarısız** (uygulanmamış),
  `git apply --check` **geçti**, uygulama zorlamasız yapıldı; `git diff --check` **temiz**.
- `manifest.json` içindeki **9 dosyanın tamamı** hem LF hem CRLF SHA-256 karşılığıyla **birebir
  eşleşti**. Dosyalar `replacement-files/`'tan körlemesine kopyalanmadı; yalnız patch uygulandı.
- Değişenler: `electron/harness-acp.ts`, `harness-mcp.ts`, `harness-recovery.ts`,
  `tests/fixtures/harness-acp.cjs`, `tests/harness-mcp.test.ts`, `tests/harness-recovery.test.ts`,
  `package.json` + `package-lock.json` (yalnız sürüm satırı: 1.9.176) ve bu sürüm notu.
  Bağımlılık eklenmedi.

## Bu makinede ölçülen geçit (Windows)

- `npm run typecheck` ✓ (üç proje).
- İlgili **9 dosya: 100 test** — **99 geçti, 1 atlandı, 0 başarısız**. Atlanan test POSIX süreç grubu
  regresyonudur; Windows'ta bilinçli atlanır (not: bu sürümde 8 yeni regresyon testi geldi;
  Harness testleri 35).
- `npx vitest run` → **209 dosya / 1642 test** (1641 geçti, 1 atlandı, 0 başarısız); 1.9.175'te
  209/1634 ve atlama yoktu.
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 → **98 geçti, 21 atlandı, 0 başarısız**.
- Yedi PowerShell **5.1** harness'ı `exit=0`: `test-worker`, `test-keyboard-safety`,
  `test-visual-input`, `test-screen`, `test-scan-frame`, `test-visual-crop-geometry`,
  `test-screen-opaque`. (`test-screen` çıktısındaki bitmap bırakma **PARTIAL** notu eskiden beri var;
  `a11y/screen.ps1` değişmedi.)
- `npm run build:electron` ✓ (renderer + Electron main).

## Sınırlar (dürüst)

- Paketin kendi Linux ortamında tam tarama **kırmızıydı** (14 başarısız + 1 yükleme hatası; temiz
  tabanla birebir aynı küme). Bu makinede **yeşil**; bu, Windows davranışının canlı kanıtı değildir.
- **Gerçek Windows/DeepSeek kabulü yapılmadı**: kurulu Harness ile ACP v1 + HTTP MCP bağlantısı,
  model görsel desteği, EXE/CMD/JS yolları, boşluk/Türkçe karakterli yollar, gerçek Blender/Hunyuan
  işlemlerinde Stop/iptal ve kapatılan pencerede `windowTitle: ""` geçişi denenmedi.
- Windows taskkill ana süreç önceden çökmüşse veya uygulama bağımsız süreç olarak ayrılmışsa bütün
  alt süreçlerin kapanmasını garanti etmez; Job Object gözetimi bu sürümde yok. MCP yetkisi her
  kapanışta iptal edilir; ana süreç kapanışı doğrulanamazsa akış sürdürülmez.
- Yönetici/UAC yetkisi verilmez; mevcut kullanıcı hakları geçerlidir.

## EXE

`Nubbo-1.9.176.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.176.exe` · SHA256 `BEKLENIYOR`.
