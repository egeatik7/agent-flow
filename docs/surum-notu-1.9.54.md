# Sürüm notu — 1.9.54 (Nubbo_Tuvaller_Shared_Catalog_Upgrade)

Kaynak: kullanıcının `Nubbo_Tuvaller_Ortak_Depo_Duzeltmesi` paketi. SHA256SUMS doğrulandı: **10 dosyanın
hepsi AYNI** ✓. Ters kontrol başarısız (uygulanmamış) → düz kontrol başarılı → **zorlamadan** uygulandı ✓;
`git diff --check` temiz ✓; **14 dosya** ✓.

**Kullanıcı profili yedeklendi** ✓ (rehberin şartı ✓): `%APPDATA%\xp-agent-studio\yedek\config-1.9.53-<tarih>.json`
— çünkü **yeni kütüphane biçimini eski EXE anlamayabilir** ✗; eski sürümle aynı yeni profili kaydetmemek gerekir.

## Değişen davranış
- **Tuvaller artık ayrı sabit panel değil** ✗ → sağ panelde **Node / LLM / Ayarlar / Ajan**'ın yanında
  **sekme** ✓; içinde **Tuval Deposu** ve **Otomasyonlar** ekranları ✓.
- **Otomasyonlar artık graph kopyası saklamıyor** ✗ → tek depodaki tuvallere bağlı **sıralı listeler**
  (`entries` + `canvasId` ✓).
- **Düzenle → Depodan tuval seç → Ekle** ile genişletme ✓, üye **çıkarma/sıralama** ✓, **Kaydet** ile saklama ✓;
  üye ekleme/çıkarma/sıra **taslak** olarak kalır ✓ (yalnız **Kaydet**'te yazılır ✓, ekranlar arası geçişte
  taslak korunur ✓).
- Depodan **yeniden adlandırma/kaydetme** → onu kullanan **bütün otomasyonlar ve bağlı açık sekmeler** aynı
  kaydı gösterir ✓.
- **Otomasyondan çıkarmak depodan silmez** ✓; **depodan silmek** bütün gruplardaki referansları **temizler**
  ve **onay ister** ✓ (Hayır/Escape iptal ✓; açık çalışma kopyaları kaybolmaz ✓).
- **Önceki kayıtlar içerik kaybetmeden taşınır** ✓ (idempotent ✓); eski otomasyon kopyası depodakinden
  **farklıysa ayrı kayıt** olarak korunur ✓; tam eşleşen eski grup sekmeleri kayda bağlanır ✓.
- **Import/Export** içerik ve sırayı korur ✓; eski **v1** otomasyon dosyası açılır ✓; **bozuk import atomik
  reddedilir** ✓; farklı içerik mevcut depo kaydının **üstüne yazılmaz** ✓.
- Önceki **▶/■** davranışı aynı ✓: soldan sağa ✓, **gerçek Bitti**'ye ulaşınca sonraki tuval ✓, hata/Durdur
  sonrası kalan sıra **başlamaz** ✓.
- **2 geliştirme bağımlılığı** eklendi ✓ (`react-test-renderer` 18.3.1 + `@types/react-test-renderer` 18.3.0 ✓)
  — **çalışma zamanı yeteneği değil** ✗; kullanıcıya yeni OCR/model bağımlılığı **yok** ✓.

## Değişmeyenler
**OCR, tıklama, yazma ve koşu motoru** dosyaları bu düzeltmede **değiştirilmedi** ✓; önceki düzeltmeler
(birleşik OCR/Koşul, popup hedefi, doğrudan girdi, İnisiyatif) **korundu** ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm install` ✓ (kilit dosyasıyla uyumlu ✓) · `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest: 51+ dosya, 385+ test geçti** ✓ (paketin 385'i ile uyumlu ✓; paketin 5 atlaması burada koştu ✓)
- **Sekiz Node regresyon dosyası: 116 pass / 0 fail** ✓ (paketin 116'sı ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓ (bu paket .ps1'e dokunmadı ✓)
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst) — **canlı UI denemesi yapılmadı**
- **Native Windows/Electron penceresinde fare/klavye ile canlı UI denemesi, ekran ölçeği/görsel yerleşim,
  gerçek OCR/model/üretim akışı ve saatler süren koşu denenmedi** ✗ (paketin de yazdığı sınır ✓);
  React test renderer **gerçek Windows masaüstü değildir** ✗.
- Canlı liste (rehber §5, 11 madde ✓) — en kritikleri: (1) sağ panelde **Tuvaller sekmesi** olmalı, ayrı
  sabit kutu **olmamalı** ✗; (2) A/B/C deposu + **Düzenle → C'yi Ekle → Kaydet** → liste **A/B/C** olmalı ve
  depo C'yi **kopyalamamalı** ✗; (3) B'yi yalnız otomasyondan çıkar → B **depoda kalmalı** ✓; (4) sırala,
  kaydetmeden geçiş yap → **taslak korunmalı** ✓; (5) depodan adı değiştir → **bütün gruplar ve açık
  sekmeler** yeni adı göstermeli ✓; (6) A'nın içeriğini değiştir + kaydet → iki otomasyonun **Aç/Export**'u
  güncel A'yı kullanmalı ✓; (7) otomasyondaki Kaydet **yalnız** düzenlenen üyeleri/sırayı saklamalı ✗
  (ilgisiz liste kopyalamamalı ✗); (8) Kapat yalnız sekmeyi kapatmalı ✓; **×** onaydan sonra kaydı bütün
  referanslarıyla silmeli ✓; (9) Export/Import + eski **v1** dosyası ✓; (10) yeniden başlat → üyeler/adlar/
  sıra korunmalı ✓, silinenler **geri gelmemeli** ✗, eski gruplar **tekrar kopya üretmemeli** ✗;
  (11) **▶/■** davranışı aynı kalmalı ✓.
- **Eski EXE ile aynı yeni profili kaydetmeyin** ✗ (yeni kütüphane biçimi eski sürümce anlaşılmayabilir ✗);
  yedek: `%APPDATA%\xp-agent-studio\yedek\config-1.9.53-<tarih>.json` ✓.