# Sürüm notu — 1.9.130 (canlı bellek göstergesi)

**Taban:** `122fe07` (1.9.129). Yeni özellik: **kartta canlı bellek göstergesi** — Blender ile yerel
model birlikte çalışırken bilgisayarın bellek durumu okunur biçimde izlenir.

Kapsam sözü: bu özellik **yalnız ölçüm ve raporlama** yapar. Bellek temizleme, süreç kapatma, model
boşaltma, üretim/ayar değiştirme, LLM çağrısı ve yeni yardımcı EXE **eklenmedi**. Mevcut JSON,
otomasyon ve akış davranışı korunur.

## Kullanıcının gördüğü sonuç

Kartta kısa bölüm (iki satır):

```
RAM 10,4 / 15,8 GB · VRAM 0,9 / 12,0 GB
Bellek bütçesi 14,6 / 36,7 GB · kalan 22,2 GB
```

Altında (blok içinde kaydırılan) ayrıntı:

- **GPU başına VRAM** (çoklu GPU ayrı ayrı; birleştirilip tek toplam gibi gösterilmez).
- **Blender süreçleri** — toplam **private bytes (commit)** ve **working set**.
- **Yerel model çalıştırıcıları** — aynı iki sayaç. Süreç **ağacı** (Ollama kökü + tüm soy) önce
  denenir; ağaç kurulamazsa tanınan çalıştırıcı adları kullanılır ve kaynak `ağaç`/`isim` diye yazılır.
  Adından "GUI-Owl" gibi bir varsayım yapılmaz.
- **Açıklamalar:** “RAM: fiziksel bellek.” · “Bellek bütçesi: Windows’un RAM ve sayfa dosyasıyla
  karşılayabildiği bellek.” · süreç commit’inin **fiziksel RAM kullanımı olmadığı** · working set
  toplamında **ortak (paylaşılan) sayfaların** birden çok sayılabileceği.
- **Bellek bütçesi daralıyor** uyarısı: commit doluluğu **%90 ve üstünde**. Bir **gösterge eşiğidir**;
  çökme tahmini veya kesin güvenlik garantisi değildir (kartta da böyle yazılır).
- Ölçülemeyen değer **“bilinmiyor”**; başarısız ölçümde elde kalan örnek **“eski ölçüm”** ve **yaşı**
  ile gösterilir; süreç kapandıysa eski tüketim güncelmiş gibi tutulmaz.

Mevcut bağlam göstergesi, kronometreler, aşama şeridi ve döngü satırları **korunur**.
Aynı ölçüm nesnesi **Android izleyiciye** aktarılır (masaüstüyle aynı iki satır, ayrıntılar kendi
bloğunda kaydırılır).

## Veri kaynakları (uydurma yok)

| Değer | Kaynak |
| --- | --- |
| RAM kullanılan/toplam | `GlobalMemoryStatusEx` (kernel32, belgelenmiş): `ullTotalPhys`/`ullAvailPhys` |
| Sistem bellek bütçesi (commit) | **ÖNCE** Windows performans sayacı `\Memory\Committed Bytes` + `\Memory\Commit Limit`; okunamazsa **aynı belgelenmiş yapının** sayfa dosyası alanları (`ullTotalPageFile`, `ullAvailPageFile`). Hangisinin kullanıldığı kartta ve günlükte **yazılır** |
| Kalan bütçe | commit sınırı − commit kullanımı |
| VRAM | `nvidia-smi --query-gpu=index,name,memory.used,memory.total`, **GPU başına** |
| Blender süreçleri | `blender.exe` — private bytes ve working set toplamı |
| Yerel model çalıştırıcıları | Ollama süreç **ağacı** (`ParentProcessId`), yoksa çalıştırıcı adları |

Kurallar: **sistem commit’i süreç sayaçları toplanarak ÜRETİLMEZ** (doğrudan Windows değerinden).
Süreç **private bytes** değeri **fiziksel RAM diye etiketlenmez**. Ollama `size_vram` toplamı
**toplam GPU kullanımına eşitlenmez**.

## Ölçüm davranışı

- **~3 saniyede bir** yenileme; **önceki ölçüm bitmeden yenisi BAŞLATILMAZ** (`olcuyor()` kapısı).
- Sorgular **asenkron** `spawn` ile: **senkron süreç çalıştırma yoktur**; ana süreç ve otomasyon
  beklemez. Zaman aşımında süreç **ağacıyla** öldürülür (`taskkill /T /F`), asılı ölçüm birikmez.
- Ölçüm için **tek** PowerShell süreci kullanılır (sistem + süreç sayaçları birlikte); GPU ayrı ve
  paraleldir. Böylece ölçümün kendisi yüke dönüşmez.
- **Günlük:** her 3 saniyede tüm ölçüm diske **yazılmaz**. Yalnız **çalıştırma başlangıcı**, **uyarı
  eşiği geçişleri** ve **hata anı** kaydedilir. Hata kaydında örneğin **yaşı** yazılır
  (“son geçerli örnek … ms önce alındı”).
- Aktarım **zaman damgalı veri nesnesi** olarak yapılır (main → HUD → izleyici); **günlük metni
  ayrıştırılmaz**.

## Bu sürümde düzeltilen ÖLÇÜLMÜŞ kusur

Gerçek tarayıcıda (Chrome, 456×pencere) ölçüldü: `.hud` **içerik kutusu** modelindeydi ve
yüzde yükseklik + 6px iç boşluk kutuyu pencereden **12px daha uzun** yapıyordu. Sonuç: en alttaki
(**)döngü satırı** pencerenin dışında kalıyordu** ve `html.hud-root` üzerindeki taşma gizleme onu
kesiyordu — yani satır **gerçekten görünmüyordu**. `.hud` artık `box-sizing: border-box`. Bu,
bellek satırı eklenmeden önce de var olan bir kusurdu; yeni test onu yakalar.

Kart penceresi **456×254** oldu (196'dan): beş satırın tamamı sığar, durum kartı satırı **84px**
(1.9.129'da 78px), durum metni kırpılmaz. Kart hâlâ ekranın **alt sağına sabittir** ve sınırlıdır.

## Doğrulama

- `npm run typecheck` ✓ **0 hata** (üç proje).
- `npx vitest run` → **137 dosya / 1069 test, 0 kırmızı**.
  - Yeni `tests/memory-meter.test.ts` (**40 test**): geçerli sayaç · eksik sayaç ve sayfa dosyası
    yedeği · sistem belleği hiç okunamazsa “bilinmiyor” · **sistem commit’inin süreç toplamından
    üretilmediği** · süreç grubu (ağaç/i̇sim, ağaç içi çift sayım yok) · çoklu GPU ayrımı ·
    **ölçüm zaman aşımı** · **kapanan süreç** · **üst üste sorgu başlatılmaması** · **eski ölçüm
    gösterimi** · **kapanış temizliği** (`dur()` sonrası kart yazılmaz) · günlük eşik geçişi ve hata
    yaşı.
  - Yeni `tests/render-overflow-audit.test.ts` (**2 test**): gerçek bileşenler + gerçek CSS, **gerçek
    Chrome**'da 456×254 ve 390×844 çizilir; taşma, kırpma, pencere dışı satır ve durum kartı
    yüksekliği ölçülür.
  - Mevcut HUD testleri bağlam göstergesi/kronometre/aşama şeridini koruduğunu doğrular (16 test).
- Beş Node paketi: `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- **12 PowerShell harness** → 12/12 geçti (masaüstüne girdi gönderilmedi; hepsi taklit).
- `npm run build:electron` ✓ · `npm run pack:win` ile paketlendi.

## Canlı doğrulama (dürüst sınır)

`test-artifacts/canli-dogrulama.cjs` **üretim modülünü** (`dist-electron/memory-meter.js`) çağırır —
sahte değer yok:

- Gerçek ölçüm (706 ms): RAM **15,84 GB** toplam / **10,45 GB** kullanılan; commit sınırı
  **36,74 GB**, kullanılan **14,59 GB**, kalan **22,16 GB**, doluluk **%39,7**;
  `nvidia-smi` → **RTX 3060 0,9 / 12,0 GB**.
- Süreç grubu **canlı sınandı**: geçici bir `blender.exe` kopyası başlatıldı → kart
  “Blender · 1 süreç · commit 0,1 GB · working set 0,1 GB”. Süreç kapatıldıktan sonra grup
  **kayboldu** (eski tüketim güncel gibi tutulmuyor).
- Döngü: 5 saniyede **3 örnek**, **en fazla eşzamanlı ölçüm 1**.
- **Sınır:** bu oturumun geliştirme kabuğu `Get-Counter`/WMI'ı engellediği için commit değeri
  **sayfa dosyası** kaynağından geldi (`kaynak: sayfa-dosyasi`) — bu, tasarlanmış **yedek yoldur** ve
  kartta açıkça yazılır. Performans **sayacı** yolunun canlı okuması bu ortamda **doğrulanamadı**;
  ayrıştırma ve yedek davranışı testle sabitlendi. Gerçek Blender/Ollama yükü altında ölçüm
  yapılmadı (makinede ikisi de çalışmıyordu).
