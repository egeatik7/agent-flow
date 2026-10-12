# Sürüm notu — 1.9.97 (Koşul yürütme + node bazlı yöntem/prompt paneli + son bug düzeltmeleri)

**Kaynak**: `Nubbo_Kosul_Yontemler_Son_Patch` → **`02_Kosul_Panel_ve_Son_Duzeltmeler.patch`**
(SHA256 `7aa43198…`). Kurulum dosyası "tek patch seç" diyor: `01` panel paketi (`34db02d`)
uygulanmışsa, `02` **yalnız Tur 1 + Tur 2 uygulanmışsa** (`a06a970`), `03` ise özgün 1.9.93 için.
Bizim ağaç Tur 1 + Tur 2'yi **uygulanmış** durumda (1.9.94/1.9.95) ve üstüne kendi denetim Tur 3
düzeltmelerimizi taşıyor (1.9.96) → **doğru seçim `02`** oldu; `01` ve `03` bilinçli olarak
**uygulanmadı**.

## Uygulama (zorlamadan, üç-yönlü birleştirme)

- Düz `git apply --check` iki dosyada çakıştı (`electron/agent.ts` — kendi Tur 3 eşitlik/model
  bağlamamız; `src/components/LlmPanel.tsx`) → **zorlamadan** `git apply --3way` kullanıldı:
  `--3way --check` **geçti**, uygulama tüm dosyalarda **"cleanly"** raporlandı ve ağaçta
  **hiç çakışma işareti kalmadı** ✓.
- **Tur 3 düzeltmelerimiz korundu** ✓ (ölçüldü: `newTally` 6, `libraryError` 13, `stableStartId` 2,
  `WORD_CANDIDATE_LIMIT` 4, `catalogFailureRef` 6, `stepFailures` 7, `CanvasTabs` `tabIndex` 2 iz).
- **Tur 3'te dokunmadığımız 17 dosyanın tamamı** paketin `Degisen_Kaynaklar` kopyasıyla
  **birebir aynı** ✓ (a11y-bridge, llm-flow, node-methods, observation-budget, openrouter, yap,
  LlmPanel, SidePanel, xp.css, test-stability-agent, beş yeni test dosyası, yeni ilerleme belgesi).

## Paketin getirdikleri

1. **Koşul yürütme** ✓: bir koşul turu **UIA + birleşik Windows/ONNX OCR**; UIA artık yalnız `Text`
   değil; tırnaklı kesin metin **öğenin TAM normalize metniyle** yerel eşleşir (log/talimat içindeki
   parça eşleşmesi pozitif sayılmaz) ✓; `conditionUia`/`conditionOcr` **ayrı ve temkinli promptlar**,
   liste/tıkla promptu Koşul'a sızmaz ✓; pencere seçimi `readOnly:true`, belirsizlikte bir kez tüm
   ekrana geçiş, yazısız UIA/simge **teknik hatası No sayılmaz** ✓.
2. **Koşul süresi tüm turu sınırlar** ✓: deadline HTTP isteğini `AbortController` ile iptal eder,
   kuyruktaki Windows okuması gönderilmez, geç gelen sonuç kullanılmaz, iptal yeni model/fallback
   çağrısına dönüşmez; turlar arası uyku kalan süreden uzun olmaz; **süre 0 = tek tur** anlamı korunur ✓.
3. **Node sekmeli yöntem/prompt paneli** ✓: aktif tüm node türleri ayrı sekmelerde, sekmeler
   klavyeyle (sağ/sol, Home/End) gezilebilir, sekmeler arası taslaklar korunur, **tek prompt
   sıfırlama diğerlerini bozmaz**, yalnız LLM'siz node'larda sahte editör yok ✓.
4. **Türkçe özel promptları silen filtre kaldırıldı** ✓: kullanıcının promptu artık dili yüzünden
   kaybolmaz (tanınmayan anahtarlar ve boş/varsayılan değerler yine elenir).
5. Pencere dışına fallback'te **istenen pencere bağlamı modelin gerçek mesajında korunur** ✓.

## Doğrulama (bu derlemede, Windows'ta koşuldu)

- `typecheck` ✓ (üç proje) · **Vitest 111 dosya / 857 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.96 tabanı 108/838 → **+3 dosya / +19 test**).
- **Beş Node paketi + `test:lock`** ✓ (keys 3, input 7, recovery 27+12 atlandı, targeting 20,
  stability 40+9 atlandı, lock 1 — hepsi 0 kırmızı).
- **On bir PS 5.1 harness'i** exit 0 ✓ · `git diff --check` temiz ✓.
- Paketin kendi kanıt dosyaları ayrıca okundu (`Test-Kanitlari/*`): yazar tarafında 792 Vitest /
  98 Node testi yeşil, tip kontrolü ve derleme başarılı; **EXE ve canlı Windows denenmemiş** ✗.

## Sınırlar

- Başlamış **native ONNX inference** zorla durdurulamaz; koşul süresi yine sınırlanır ve geç sonuç
  kullanılmaz, ama native işlem arka planda biter (paketin de yazdığı sınır) ✗.
- **Görsel Koşul kapalı** kaldı (kullanıcı görsel incelemeden emin olmadığını belirttiği için bu
  görevde görsel karara yeni seçenek eklenmedi) ✗.
- **Canlı Windows/PowerShell UIA-OCR, fiziksel masaüstü ve tablet** bu derlemede de sınanmadı ✗;
  ayrıca 1.9.96 notundaki "bu sürüme alınmayan" kalemler (typeText korumalı dalı, Yap `allowCode`
  varsayılanı, ONNX hatasının arayüzde görünmemesi, izin kapsamı, yerel anahtar, profil klasörü
  çakışması, exe damgası) **hâlâ açık** ✗.
