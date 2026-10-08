# Sürüm notu — 1.9.53 (Nubbo_Tuvaller_Otomasyonlar)

Kaynak: kullanıcının `Nubbo_Tuvaller_Otomasyonlar_Patch` paketi. SHA256SUMS doğrulandı: **11 dosyanın
hepsi AYNI** ✓. Paket seçimi: birleşik OCR zaten uygulandığı için (1.9.52) **`Nubbo_Tuvaller_Only.patch`**
kullanıldı ✓; `With_Combined_OCR` **uygulanmadı** ✓ (rehber: "ikisini birden uygulama").
`git apply --reverse --check` başarısız (uygulanmamış) → düz kontrol başarılı → **zorlamadan** uygulandı ✓;
`git diff --check` temiz ✓; **20 dosya** ✓.

## Ne geliyor
- **Tuval kitaplığı** (`electron/canvas-library.ts` + `src/components/CanvasLibrary.tsx`): kayıtlı tuvaller
  sağ panelde kalıcı kayıt olarak durur; sekme açıp kapatınca **kaybolmaz** ✓. Sekmeler sağdaki kayıtlara
  taşınır ✓.
- **Otomasyonlar / gruplar**: bağımsız içerik ve **sıra** kaydı ✓; Tuvali Kaydet ✓, `+` ile yeni bağımsız
  sekme ✓ (bir sekmedeki düzenleme diğerini değiştirmez ✓), yeniden adlandırma ✓, çocuk ↑/↓/sil ✓,
  Export/İçe Aktar ✓ (İçe Aktar açık sekmeleri **ezmez** ✓).
- **Silme onayı**: kırmızı × → uyarı ✓; Hayır/Escape → kayıt durur ✓; Evet → silinir ✓; **Hayır'a klavye
  ile odaklanıp Enter'a basmak Evet sayılmaz** ✓.
- **Sıralı oynatma** (`src/lib/canvas-sequence.ts`): üst ▶ ile A → B → C ✓; B beklerken ■ → **C başlamaz** ✓;
  Durdur'dan sonra ▶ **soldan** başlar ✓; bir tuvalin **Bitti** bağlantısı kopuksa (Bitti var ama
  ulaşılmıyor) sıra onu **başlatmaz** ✓; Başlangıç veya Bitti tamamen eksikse **hiçbir tuval başlamaz** ✓.
- `src/App.tsx` kitaplık + sıralı oynatma bağlandı ✓; sürükle-bırak bağımlılığı yok ✓ (yeni bağımlılık yok ✓).

## Değişmeyenler
Tek-tuval koşuları, **OCR**, **tıklama**, **yazma** ve **kısayol** davranışları bu geliştirme nedeniyle
**değiştirilmedi** ✓; önceki birleşik OCR/Koşul düzeltmesi **korundu** ✓; kullanıcının mevcut akışları ve
node'ları dönüştürülmedi ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ (renderer + main + test tip denetimi ✓) · `npm run build:electron` ✓
- **Vitest: 48+ dosya, 366+ test geçti** ✓ (paketin 366'sı ile uyumlu ✓; paketin 5 atlaması burada koştu ✓)
- **Sekiz Node regresyon dosyası: 116 pass / 0 fail** ✓ (paketin 116'sı ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓ (bu paket .ps1'e dokunmadı; regresyon için koşuldu ✓)
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst) — **canlı UI denemesi yapılmadı**
- **Gerçek Electron/Windows pencere etkileşimi, panel boyutu/ölçek görsel kontrolü ve klavye ile silme
  onayı denenmedi** ✗ (paket de headless tarayıcı indiremediği için **tıklamalı UI testi yapamamış** ✗;
  statik React HTML testleri o denemenin **yerine geçmez** ✗).
- Kullanıcının yapması gereken kısa canlı liste ✓: (1) açık sekmeler/node'lar korunmuş mu ✓, eskiler
  sağdaki kayıtlara taşınmış mı ✓; (2) Tuvali Kaydet → listede kayıt ✓, `+` → bağımsız sekme ✓ (bir
  sekmedeki düzenleme diğerini değiştirmemeli ✓); (3) kırmızı × → Hayır/Escape durdurur ✓, Evet siler ✓,
  **Hayır'a odaklanıp Enter Evet sayılmamalı** ✓; (4) A/B/C tuval + sıralama ✓; (5) otomasyon sırası
  sağdaki ile üstteki **aynı** olmalı ✓, yeniden adlandır/↑/↓/sil/Export/İçe Aktar ✓; (6) grubun Aç'ı
  açık sekmeleri değiştirirken onay istemeli ✓; (7) ▶ A → B → C ✓, B beklerken ■ → **C başlamamalı** ✓,
  Durdur'dan sonra **soldan** başlamalı ✓; (8) Bitti bağlantısı kopuk tuval **başlamamalı** ✓, Başlangıç/
  Bitti eksikse **hiçbiri** başlamamalı ✓; (9) çok sekme + dar pencere ✓ (soldaki ▶/■ görünür kalmalı ✓);
  (10) yeniden başlat → kayıtlar/gruplar/sıra/açık sekmeler **korunmalı** ✓.
- **Kullanıcının gerçek üretim/remesh akışı bu turda çalıştırılmadı** ✗ (rehberin açık uyarısı ✓).