# Nubbo 1.9.177 — DeepSeek Harness başlatma düzeltmesi

Taban: GitHub main `0df4a2e3e994eab40ea8b08e6009c2cdea3c94d8` (1.9.176).

## Sorun ve somut değişiklik

Gönderilen raporda kurtarma 474 ms içinde, hiç araç çalıştırmadan `Harness kapandı (0)` ile bitiyor. Stderr Chromium cache erişim hataları içeriyor; seçilen EXE ve argümanlar raporda olmadığı için bu dosyalardan tek başına kesin çalıştırıcı/kök neden belirlenemez.

Kodda doğrulanan eksik: seçilen EXE doğrudan normal program olarak başlatılıyordu. Resmî DeepSeek masaüstü EXE'si bu şekilde ACP stdio sunucusu yerine masaüstü uygulamasına girebilir. Resmî kurulumun paketli CLI çalıştırıcısı ise aynı EXE'yi `ELECTRON_RUN_AS_NODE=1`, `--expose-internals` ve `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` ile çalıştırır.

Bu sürüm Windows'ta `DeepSeek Harness.exe` seçilince aynı kurulumun paketli CLI girişini bulur ve resmî çalıştırıcının Node-mode çağrısını doğrudan uygular. Böylece Nubbo'nun kendi Electron/Node sürümüyle yabancı CLI çalıştırmak veya GUI açmak gerekmez. CLI eksikse GUI açılmadan açık hata verilir. Bu yalnız başlatma yolunu değiştirir; Harness'ın profil, oturum ve kimlik bilgileri yeniden yazılmaz. Npm CLI / dsh.cmd / özel JS ACP çalıştırıcıları desteklenmeye devam eder. Genel JS seçeneği Nubbo'nun Node runtime'ını kullanır; güncel Harness için masaüstü EXE'si veya resmî dsh.cmd tercih edilmelidir.

Diğer düzeltmeler:

- Varsayılan çalışma klasörü kurulum klasörü yerine kullanıcı temp alanındaki `nubbo-harness-workspace` olur. Açıkça verilen mutlak çalışma klasörü korunur; yoksa sessizce başka klasöre düşülmez.
- Nubbo'nun kendi EXE'si kurtarma programı olarak seçilirse başlatılmaz; doğru uygulamayı seçmeyi söyleyen hata verilir.
- Seçilen program, gerçek çalıştırıcı, başlatma modu ve çalışma klasörü rapora eklenir; hata mesajında initialize/session/new/session/prompt aşaması görülür.
- Erken çıkış kodu 0 olsa da ACP görevi tamamlanmış sayılmaz. Cache mesajı kesin kök neden olarak sunulmaz.
- Hata tanılamasında yaygın anahtar/token biçimleri maskelenir; CLI argümanları günlüğe dökülmez.
- Bağlantı testi ve gerçek kurtarma, aynı başlatma/çalışma klasörü yolunu kullanır. HTTP MCP araç listesi gerçekten keşfedilmeden bağlantı hazır sayılmaz. Bağlantı testi model/API isteği veya masaüstü eylemi yapmaz.
- Harness seçiliyken başka kurtarma ajanına otomatik geçiş yoktur; önceki sınırsız devam ve Stop davranışı korunur.

## Kaynakla karşılaştırma

Resmî DeepSeek kaynak ağacı `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` üzerinden incelendi:

- https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/cli/dsh.cmd
- https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/acp/acp/README.md

## Doğrulama ve sınırlar

İlgili 10 dosyada 114 test geçti; bunun 49'u Harness testidir, 14 yeni regresyon testi eklenmiştir. Üç TypeScript projesi ve renderer/main derlemesi geçti. Tam test paketi ve taban karşılaştırması teslim paketinin DOGRULAMA.md dosyasındadır.

Windows başlatma planı resmî kaynak ve dosya sistemi senaryolarıyla test edildi. ACP/MCP davranışı gerçek yerel fixture süreciyle test edildi. Bu ortamda kurulu Windows DeepSeek EXE'si ve kullanıcının model/API profili bulunmadığı için o kurulumda çalıştığı iddia edilmez. Yerel bağlantı testi başarılı olduktan sonra gerçek kurtarma denenmelidir. Eski/eksik masaüstü sürümünde paketli ACP profili yoksa Harness güncellenmelidir; Nubbo bağımlılık kurmaz veya kullanıcı profilini sıfırlamaz. Windows alt süreç kapanışıyla ilgili 1.9.176 sınırı devam eder; bu sürüm Job Object eklemez.

Bu patch sekme otomasyonunu veya konuşulan devam/tur seçimi arayüzünü değiştirmez. Yeni bağımlılık yoktur.

## Paket doğrulaması (yerel, Windows)

Kaynak paket: `C:\Users\ASUS TUF\Downloads\Nubbo-Harness-Baslatma-Patch-1.9.177\Nubbo-Harness-Baslatma-Patch-1.9.177`
(`nubbo-harness-1.9.177.patch`, `manifest.json`, `replacement-files/`, `verification/`).

- Taban `0df4a2e` (1.9.176) temizdi; `git apply --reverse --check` **başarısız** (uygulanmamış),
  `git apply --check` **geçti**, uygulama zorlamasız yapıldı; `git diff --check` **temiz**.
- `manifest.json` içindeki **13 dosyanın tamamı** hem LF hem CRLF SHA-256 karşılığıyla **birebir
  eşleşti**. Dosyalar `replacement-files/`'tan körlemesine kopyalanmadı; yalnız patch uygulandı.
- Yeni dosyalar: `electron/harness-launch.ts`, `tests/harness-launch.test.ts`. Sürüm 1.9.177
  (`package.json` + `package-lock.json` kökü). Yeni bağımlılık yok.

## Bu makinede ölçülen geçit (Windows)

- `npm run typecheck` ✓ (üç proje).
- İlgili **10 dosya: 114 test** — **113 geçti, 1 atlandı, 0 başarısız** (atlanan test POSIX süreç
  grubu regresyonu; Windows'ta bilinçli atlanır). 49'u Harness testi, 14'ü bu sürümde eklendi.
- `npx vitest run` → **210 dosya / 1656 test** (1655 geçti, 1 atlandı, 0 başarısız);
  1.9.176'da 209/1642.
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 → **98 geçti, 21 atlandı, 0 başarısız**.
- Yedi PowerShell **5.1** harness'ı `exit=0` (`test-screen` PARTIAL notu eskiden beri var).
- `npm run build:electron` ✓ (renderer + Electron main).

## Canlı başlatma denemesi (bu makinede, kurulu Harness)

Bu makinede kurulu `DeepSeek Harness.exe` (`…\AppData\Local\Programs\DeepSeek Harness`) üzerinde
yeni başlatma yolu **gerçekten denendi** (yalnız ACP `initialize`; model çağrısı, masaüstü girdisi ve
GUI yok):

- Asar başlığında paketli giriş **var**: `/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`
  (`resources/app.asar`, `/dsh/` altında 17.262 dosya). Yani patch'in aradığı yol bu kurulumda mevcut.
- `harnessLaunch` → mod **`desktop-cli`**, çalışma klasörü `%TEMP%\nubbo-harness-workspace`.
- ACP `initialize` **2,1 sn'de başarılı**: `protocolVersion: 1`, ajan `deepseek-harness-acp 0.0.1`,
  `mcpCapabilities.http: true`. Oturum kapatıldı, artık süreç kalmadı.
- **Dikkat:** aynı yanıt `promptCapabilities.image: false` bildirdi. Yani bağlantı kuruluyor ama bu
  profil görüntü yeteneği bildirmiyor; kurtarmanın ekran kanıtı gerektiren adımlarında Harness
  görseli göremeyebilir. Paketin "görsel destek doğrulanmaz" notu bu makinede somutlaştı: gerçek
  kurtarmada kontrol edilmeli, model/profil değiştirmek gerekebilir.

## Sınırlar (dürüst)

- Canlı deneme yalnız **el sıkışma**dır: `session/new`, `session/prompt`, gerçek model yanıtı,
  Nubbo MCP `tools/list` keşfi ve masaüstü eylemi denenmedi. "kesin düzeldi" denmiyor.
- Kullanıcının Harness profilleri/kimlik bilgileri değiştirilmedi, sıfırlanmadı; yönetici/UAC
  yetkisi verilmedi.
- Windows'ta ana süreç önceden çökmüşse veya alt süreç bağımsızlaşmışsa taskkill tüm ağacı kapatmayı
  garanti etmez; Job Object gözetimi yok (1.9.176 sınırı sürer).
- Paketin kendi Linux ortamında tam tarama kırmızıydı (14 hata + 1 yükleme hatası); burada yeşil —
  Windows davranışının canlı kanıtı değildir.

## EXE

`Nubbo-1.9.177.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.177.exe` · SHA256 `BEKLENIYOR`.
