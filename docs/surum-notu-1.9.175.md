# 1.9.175 — DeepSeek Harness kurtarma

Kurtarma sekmesinde yerleşik ajan ile DeepSeek Harness arasında seçim eklenir. Harness seçiliyse diğer kurtarma ajanı hiçbir hata durumunda çağrılmaz. Sağlayıcı koşu başında sabitlenir.

Harness CLI programını seçme, ACP + Nubbo MCP bağlantısını model çağırmadan deneme, ayrı talimat, tam bilgisayar kontrolü ve süresiz/otomatik devam ayarları eklenir. Tam kontrol mevcut Windows kullanıcısının haklarıyla masaüstü, dosya/PowerShell ve tüm uygun tek-adım eylem node'larını kapsar. Yönetici/UAC yetkisi otomatik kazanılmaz. Yerleşik kurtarma ayarları korunur.

Normal akış kurtarma sırasında bekler. CLI/ACP görev ve iptal için; oturuma özel localhost MCP ise Nubbo ekran, bağlam, günlük ve eylem araçları için kullanılır. Mevcut Nubbo CLI korunur. Genel dış ajan API'si kurtarma amacıyla açılmaz; kurtarma yürütücüsü mevcut döngü öğesi ve donmuş yollarla çalışır.

Uzun işlemler jobId ile izlenir. operationId aynı eylemin tekrar gönderilmesini önler. Node hatası aynı Harness'a araç sonucu olarak döner; iç içe kurtarma yoktur. Araştırma geniş kapsamlı olabilir; çalışan tuval değiştirilemez, Paket/Döngü/Yap/Koşul node'ları kurtarma içinden yürütülmez.

Tamamlanma için son eylem sonrası modele teslim edilen geçerli ekran ve kaydedilmiş ayrıntılı Türkçe rapor gerekir. Başarısız yeni ekran okuması eski kanıtı geçersiz kılar. Belirsiz gönderim otomatik tekrarlanmaz. Durdur MCP yetkisini kaldırır ve Harness oturumu/süreç ağacını kapatır. Gönderilmiş dış uygulama işlemi geri alınmış sayılmaz.

Süresiz ayarda yerleşik 180 sn, araç çağrısı ve koşu başına kurtarma sınırları Harness'a uygulanmaz; aynı oturumda yeni turlarla devam edilir. Program/ACP/MCP hatası, bilinçli vazgeçme veya kullanıcı durdurması koşuyu durdurur. Tek PowerShell çağrısının mevcut 60 sn sınırı korunur; oturumun süresiz olması bu çağrı sınırını değiştirmez.

Model/API bilgileri seçili Harness profilinden gelir. Bağlantı testi model anahtarını veya görsel model kabiliyetini doğrulamaz; bunlar gerçek görevde değerlendirilir. ACP v1 ve HTTP MCP desteklemeyen CLI açık hatayla reddedilir.

Doğrulama: TypeScript kontrolü, Electron/renderer derlemesi, sahte harici ACP süreciyle HTTP MCP entegrasyon testleri. Gerçek Windows masaüstü ve kullanıcının kurulu DeepSeek Harness sürümü üzerinde canlı test yapılmadı. Bu paket kaynak kod patch'idir; kurulabilir Windows EXE değildir.

## Paket doğrulaması (yerel, Windows)

Kaynak paket: `C:\Users\ASUS TUF\Downloads\Nubbo-Harness-Kurtarma-Patch-1.9.175`
(`nubbo-harness-1.9.175.patch`, `manifest.json`, `replacement-files/`, `verification/`,
`Apply-Patch.ps1`, `UYGULA.cmd`).

- Taban `e31e442` (1.9.174) temizdi; `git apply --reverse --check` **başarısız** (henüz uygulanmamış),
  `git apply --check` **geçti**, uygulama zorlamasız yapıldı; `git diff --check` **temiz**.
- `manifest.json` içindeki **20 dosyanın tamamı** hem `newSha256` hem `newSha256Crlf` karşılığıyla
  **birebir eşleşti**; `replacement-files/` kopyalarının hash'leri de aynı. Dosyalar körlemesine
  kopyalanmadı, yalnız patch uygulandı (paketin etkileşimli `UGULA.cmd`/`Apply-Patch.ps1` yolu
  kullanılmadı; o yol hash kapılı + yedekli olsa da dosyayı bütünüyle değiştirir).
- `package.json` ve `package-lock.json` kök sürümü **1.9.175** olarak eşitlendi; bağımlılık
  sürümleri değişmedi (yeni bağımlılık yok).
- Yeni dosyalar: `electron/harness-acp.ts` (112), `harness-mcp.ts` (152), `harness-recovery.ts` (161),
  `tests/fixtures/harness-acp.cjs`, 4 Harness test dosyası, bu sürüm notu.

## Bu makinede ölçülen geçit (Windows)

- `npm run typecheck` ✓ (üç proje).
- Paketin istediği **9 dosya: 92/92 geçti** (`harness-recovery` 21, `harness-mcp` 4, `harness-runtime` 2,
  `harness-ui` 1 = **27 yeni Harness testi**; `recovery` 23, `recovery-runtime` 9, `recovery-handoff` 13,
  `recovery-ui` 3, `condition-recovery` 17).
- `npx vitest run` → **209 dosya / 1634 test yeşil** (1.9.174'te 205/1607; +4 dosya, +27 test).
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 → **98 geçti, 21 atlandı, 0 başarısız**.
- Yedi PowerShell **5.1** harness'ı `exit=0`: `test-worker`, `test-keyboard-safety`,
  `test-visual-input`, `test-screen`, `test-scan-frame`, `test-visual-crop-geometry`,
  `test-screen-opaque`. (`test-screen` çıktısındaki bitmap bırakma **PARTIAL** notu eskiden beri var;
  `a11y/screen.ps1` değişmedi.)
- `npm run build:electron` ✓ (renderer + Electron main).

## Sınırlar (dürüst)

- **Gerçek Windows / DeepSeek Harness kabulü yapılmadı.** ACP v1 ve localhost HTTP MCP akışı gerçek
  ayrı Node süreci ve fixture CLI ile sınandı; kullanıcının kurulu `dsh` sürümüne bağlanılmadı, gerçek
  model çağrısı ve masaüstü eylemi yapılmadı.
- Bağlantı testi **model anahtarını veya görsel yeteneği doğrulamaz**; bunlar gerçek görevde belli olur.
  Harness profili ACP destekleyen bir çalıştırıcı (`dsh.cmd` / `dsh.exe --profile … acp`) gerektirir;
  yalnız masaüstü arayüzünü açan EXE uygun değildir.
- Tam bilgisayar kontrolü mevcut Windows kullanıcısının haklarıyla sınırlıdır; yönetici/UAC yetkisi
  otomatik verilmez. Tek PowerShell çağrısının 60 sn sınırı korunur.
- Gönderilmiş dış uygulama işleri (remesh/indirme) geri alınmış sayılmaz.
- Paketin kendi Linux ortamındaki tam taraması **kırmızıydı** (14 başarısız + 1 yükleme hatası;
  checkpoint/kilit/Chrome-Electron ortam sorunları, temiz tabanla aynı küme). Bu makinede tam tarama
  **yeşil**; bu Windows davranışının canlı kanıtı değildir.

## EXE

`Nubbo-1.9.175.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.175.exe` · SHA256 `BEKLENIYOR`.
