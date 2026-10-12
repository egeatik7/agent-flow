# 1.9.93 bug düzeltmeleri — devam defteri

Başlangıç commit'i: `5f1f81df29afa15622dbd9f61c64a176095a852a`.
Çalışma dalı: `fix/audit-1.9.93-session-1` (yerel).
Tarih: 12 Ekim 2026. Bu belge kısa turların sonunda güncellenir.

## Tur 1 — tamamlandı

| Bulgu | Durum | Yapılan düzeltme ve kanıt |
| --- | --- | --- |
| Rapor §2.1: araç branch kayıtlarının kaybolması | Düzeltildi | Son kayıt sınırına `window` / `tools` yazıcı ayrımı eklendi. Araç yalnız branch kayıtlarını, pencere yalnız kendi çalışma alanını yazar. Oluşturma, düzenleme, silme ve bayat renderer kaydı gerçek `main.ts` callback'leriyle sınandı. |
| Rapor §2.7: reload sonrası dış kütüphane değişikliklerinin ezilmesi | Düzeltildi | Taze katalog `adoptBook` ile sonraki otomatik kayıtların kaynağına aktarılır. Açık tuval, paket görünümü, otomasyon taslağı ve kayıt karşılaştırma tabanı korunur. Bekleyen kayıtlar bitmeden reload yapılmaz; bu sırada yeni bayat otomatik kayıt kuyruğa giremez. |
| Yeni bulgu: ayrı kütüphane kullanan profilin her okunmasında yeniden legacy aktarımı | Düzeltildi | `librarySession` kütüphaneyi oturumdan çıkardığı için önceki `readWorkspace` her okumayı legacy aktarımı sanıp `savedId` alanlarını sekme kimlikleriyle değiştiriyordu. `libraryMigrated` işaretli profiller artık ayrı kataloğu kullanarak okunur. Eski JSON'ların ilk aktarım yolu korunur. |

Üretim kaynakları: `electron/main.ts`, `electron/workspace-store.ts`, `src/App.tsx`.
Test kaynakları: `tests/workspace-main.test.ts`, `tests/workspace-save.test.ts`, `tests/workspace-lifecycle.test.ts`.
Akış JSON şeması, node türleri ve paket/döngü çalıştırma motoru bu turda değiştirilmedi.
Uygulama sürümü bu kısmi kaynak yamasında 1.9.93 olarak kaldı.

## Doğrulama

- Orijinal commit, aynı Linux/Node ortamında: 102 Vitest dosyası; 745 geçti, 6 atlandı, 0 hata.
- Beş yeni regresyon testi orijinal üretim koduna karşı: 5 başarısız. Hatalar beklenen veri kaybı/kimlik değişimi iddialarını yeniden üretti.
- Düzeltilmiş kaynak: 103 Vitest dosyası; 750 geçti, 6 atlandı, 0 hata.
- Atlananlar değişmedi: `worker-bridge.test.ts` içindeki yalnız Windows'ta koşan 5 test; kaldırılmış kurtarma panelinin 1 testi.
- `node --test scripts/test-stability-main.cjs`: 5 geçti, 0 hata.
- `npm run typecheck`: başarılı (üç TypeScript proje kontrolü).
- `npm run build:electron`: başarılı (renderer + main JavaScript derlemesi).
- `git diff --check`: başarılı.
- Kaynak patch temiz 1.9.93 ağacına uygulanıp çıktı dosyalarının SHA-256 değerleriyle karşılaştırılır; sonuç paket doğrulamasına yazılır.
- Bu ortam Linux'tur. Gerçek Windows masaüstü, canlı iki Nubbo süreci, disk erişim hatası ve fiziksel tablet testi yapılmadı.
- Windows portable EXE üretilmedi. `build:electron` başarısı EXE paketleme/masaüstü testi anlamına gelmez.
- Normal `npm ci` ONNX GPU indirmesinde ağ zaman aşımı aldı; bağımlılıklar `npm ci --ignore-scripts --no-audit --no-fund` ile kuruldu. Yerel ONNX çıkarımı ve Electron binary çalıştırma bu doğrulamaya dahil değildir.
- Derlemede mevcut `fs`/`path` browser externalization uyarıları devam eder.

## GitHub durumu

Branch oluşturma çağrısı 403 `Resource not accessible by integration` ile reddedildi.
Uzak branch/commit/PR oluşturulmadı; main değiştirilmedi.
Teslim, yerel commit ve başlangıç commit'ine uygulanabilir kaynak patch paketidir.

## Sonraki tur: kilit sağlamlığı

Önce §2.8 ve §2.9 birlikte incelenecek: bozuk/boş kilit, yarım yazım, ölü kilidi devralma yarışı.
Kilit sahibinin korunması, iki süreç yarışının gerçekçi testi ve birden fazla LibraryStorage nesnesinin sahipliği birlikte ele alınmalı.
Yalnız parse hatasını yutup kilidi silmek yeterli ve güvenli bir çözüm sayılmayacak.

## Açık defter

Bu tablodaki maddeler bu turda doğrulanmadı veya değiştirilmedi. Orijinal raporun iddialarıdır; otomatik olarak kabul edilmez.

| Alan | Kalan kapsam |
| --- | --- |
| §2.2 | Hedef pencere bulunamayınca direct tuş gönderme; mevcut kullanıcı davranış sözleşmesini incele. |
| §2.3–2.4 | Tıklama sonrası tanılama hatası; Koşul öncesi doğrulanmamış hedef hafızası. |
| §2.5 | Koşul beklemesinde tarama/model çağrısı sıklığı ve bütçesi. |
| §2.6 | TEMP süpürmesinde çalışan başka portable örneği koruma. |
| §2.8–2.9 | Kilit yazımı/kurtarma/devralma; PID yeniden kullanımının sınırları. |
| §2.10 | `applyPlan` loop üyeliği kapanışının dış node'ları kutuya alması. |
| Runner/döngü/paket | Kimlikle sayısal devam, incomplete/blocked aktarımı, tekrarlayan hatalar, bölge sınırı, sayaçlar, boş klasör ve yol adı. |
| Hedef/girdi/eylem | Koşul odağı/UIA kapsamı, simge hafızası ve çoklu monitör, ölü yollar. |
| PowerShell worker | WinRT bekleme, OCR istisnası, yutulan occlusion hatası, PS5.1 UTF-8, VkKeyScanW, tuş/fare bırakma ve thread sızıntısı. |
| Model/yerel yönlendirme | ImageUnsupported sınıfı ve fallback, reasoning_effort, yanıt ID/koordinat doğrulama, prompt kaybı, ONNX geçici hata ve json retry. |
| IPC/ayarlar/kalıcılık | Log adı çakışması, hotkey kaydı, viewer aç/kapat yarışı, çakışma banner'ı. |
| Köprü/harness/script | Test sürecini durdurmadan token/profil yazma, UTF-8 chunk çözümü, worker send yarışı, HTTP büyük gövde hata yolu. |
| Kütüphane/SQLite/bölümler | Çakışma-dışı hatada oturum kaydı, bölümsüz klasörler, open/restore branch koruma, nonce sahipliği, bölüm/isim uyumu ve yedek maliyeti. |
| Yap/araç katmanı | Paket içi graphStamp, bayat merge yolu, geçersiz packagePath, timeout sınırı, task_complete kapısı ve HTTP endpoint yarışı. |
| Tablet/Android | İz/çerçeve sıfırlama, clone maliyeti, WS slot sınırı, close kodu, ERR_ABORTED, Tailscale boş yanıt, üç sekme ve arşiv, canvasId, QR yönleri, tam kitap yayını. |
| Performans/uzun koşu | Worker geçici dosyaları, sürüm logları, HUD listener'ı, senkron config yazımları. |
| Renderer/UI | Ölü proplar/CSS; eksik UI taraması; ağaç klavye erişimi, tabIndex, menü odağı ve Home/End. |

## Devam eden ajana

1. Tur 1 patch'ini tekrar uygulama. Önce mevcut HEAD/diff ve bu belgenin tamamlanan kısmını kontrol et.
2. Bir turu tek tamamlanabilir konuya sınırla; 30 dakika dolmadan test kanıtı ve uygulanabilir paketi teslim et.
3. Testi yapılmamış iddiaları tamamlandı sayma. Somut yeni bulguyu ayrı kayıtla taşı.
4. Akış şemasını ve kullanıcı davranışlarını koru. Sonraki patch'in hangi başlangıç commit'ine uygulandığını açıkça belirt.
