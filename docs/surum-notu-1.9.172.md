# Sürüm notu — 1.9.172 (checkpointler döngü ağacı: tur kimliği, olay anı kapsamı, tembel arayüz)

**Taban:** `5fa0f60` (1.9.171) · Kaynak paket:
`C:\Users\ASUS TUF\Downloads\Nubbo-Checkpoint-Dongu-Agaci-171`
(`DEEPSEEK-OKU.md`, `TEST-SONUCLARI.md`, `nubbo-checkpoint-agaci-171.patch`, `SHA256.json`)

## Paket doğrulaması ve değerlendirme

- Üç dosyanın SHA-256'sı `SHA256.json` ile **birebir eşleşti** (`d8889f97…`, `af1941dd…`,
  `79643ce9…`); patch temiz tabana `git apply --check` ile **sorunsuz** uygulandı
  (13 dosya, +531/−52 + 2 yeni test dosyası).
- **Değerlendirme: mantıklı.** Değişiklik yalnız gözlem/arayüz katmanı: akış dalı, tuş/tıklama/yazma,
  yeniden deneme, değişken değerleri ve kullanıcı tuvali değişmiyor; yeni bağımlılık, LLM çağrısı,
  klasör seçimi veya otomatik silme yok. Eski checkpoint kayıtları okunur kalıyor, hiyerarşi
  etiketlerden **uydurulmuyor**. `checkpointContext` hata verirse runner yalnız uyarı yazıp devam ediyor.
- **İki performans notu** (uygulamada düzelttim, aşağıda "İnceleme sertleştirmesi").

## Bu sürümdeki davranış

1. **Ağaç yapısı** (`electron/checkpoint-activity.ts`, `src/lib/checkpoint-tree.ts`): koşu/tuval →
   dış döngü → tur/öğe → iç döngü → tur/öğe → çıktılar. Aynı öğe iki kez listelenirse sıra konumu
   ayrı; aynı döngünün yeniden ziyareti ayrı `visitId`; yeni koşu/checkpoint yeniden başlatması ayrı
   deneme. Döngü dışı/ilişkisi belirlenemeyen dosyalar "Tuval / turla eşleştirilemeyen çıktılar"da.
2. **Durum dosya sayısından çıkarılmıyor**: tur durumu `running / completed / incomplete / failed /
   stopped / interrupted`. Temiz biten koşu, açık kalan turu "tamamlandı" yapmıyor (`incomplete`);
   uygulama kapanıp açılınca bitiş kaydı olmayan turlar **Kesildi**. Durum `Stop`/hata anında iç ve
   dış turların ikisine de yazılıyor.
3. **Dosya kaydı olay anına bağlı** (`checkpoint-output-watch.ts`): `fs.watch` olayı geldiğinde açık
   olan tur anahtarı saklanıyor; geciken `stat` bu ilişkiyi değiştirmiyor. Aynı Windows yolu farklı
   turlarda ayrı gözlem satırı; sağdaki liste seçili kapsamda yolu **bir kez** gösteriyor
   (`outputScopes` + `treeOutputs`). Dosyanın hangi işlem tarafından üretildiği iddia edilmiyor.
4. **Kalıcı tur günlüğü** (`electron/checkpoints.ts`): tur geçmişi ayrı, append-only
   `<sha256(runId)>.activity.jsonl` dosyasında; her turda bütün geçmiş yeniden yazılmıyor. Bozuk/yarım
   satır atlanıyor ve "eksik/bozuk satır" uyarısı gösteriliyor. Eski checkpoint JSON'ları değişmiyor.
5. **Başlatma gerçek snapshot'a dayalı**: `mark` artık `canvasStart` / `useCurrentContext` ile
   çağrılıyor. İlk kayıtta donmuş iç döngüler **aktif tur gibi çizilmiyor**; devam snapshot'ı bu
   listeleri koruyor. `Seçiliden çalıştır` yalnız kayıtlı checkpoint'i olan satırda etkin.
6. **Arayüz** (`CheckpointsPanel.tsx`): katlanır ağaç; ilk görünümde dış döngüler özet, tur ayrıntıları
   kapalı; çıktılar **seçimden sonra** yükleniyor (en çok 4 eşzamanlı istek, geç gelen cevap yeni
   seçimi ezmiyor); `Çalışan / yarım kalan turu göster` ilgili dalı açıp 250. turu **sınırlı DOM**
   ile görünür yapıyor; liste 100'er satır büyüyor; süren/yarım tur vurgusu.

## İnceleme sertleştirmesi (patch'e ek olarak)

- **Ayrıntı önbelleği**: panel her 2 saniyede seçili kapsamın **tüm** checkpoint'lerini yeniden
  okuyordu; 250 turlu bir döngü seçildiğinde bu 2 sn'de 250 NDJSON okuması demekti. Kapanmış
  checkpoint'ler önbellekten kullanılıyor, yalnız `running` olan tazeleniyor.
- **Tur günlüğü önbelleği**: `list()` her çağrıda (panel açıkken 2 sn) eski koşuların
  `.activity.jsonl` dosyasını baştan ayrıştırıyordu. Artık `mtime+boyut` aynıysa önbellekten
  okunuyor (en çok 40 koşu, LRU). Canlı koşu zaten bellekteki günlükten geliyor.

## Doğrulama (bu makinede, Windows)

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **201 dosya / 1533 test** yeşil (paketle 16 yeni test).
- Paketin istediği 8 checkpoint dosyası: **42/42** geçti.
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 — **0 kırmızı**.
- PowerShell 7 harness (worker, keyboard-safety, visual-input, screen, scan-frame,
  crop-geometry, screen-opaque) — **hepsi geçti**.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Canlı Windows kabul senaryoları (paketin 8 maddesi) çalıştırılmadı.** Ağaç, olay kapsamı,
  Stop/kesinti, 250 tur, bozuk günlük ve devam senaryoları yalnız otomatik testlerle (gerçek runner,
  React/jsdom, sahte `fs.watch`) sınandı; gerçek `fs.watch` gecikmeleri ve gerçek pencere düzeni
  görülmedi.
- Eski kayıtlarda tur hiyerarşisi yok; etiketten uydurulmuyor (bilinçli). Yeni ağaç yalnız bu
  sürümden sonra yazılan `.activity.jsonl` kayıtlarıyla dolu.
- Dosya kaydı "gözlem"dir; üretici kanıtı değildir. Aynı yolun farklı turlardaki gözlemleri
  ayrı satır, sağdaki farklı-yol listesi birleşik.
- 250 turlu bir kapsam ilk seçimde tüm checkpoint ayrıntılarını yine okur (tek sefer); sonraki
  2 sn'lik yenilemeler yalnız süren checkpoint'i tazeler.
- Paketin Linux ortamındaki tam taraması yeşil değildi (ortam kaynaklı 14 hata + 1 yükleme hatası);
  bu makinede tam tarama yeşil — Windows davranışının canlı kanıtı değildir.

## Sonraki paket (değişmedi)

GLB/indir hedeflerinin iş bağlamı, Kurtarma'ya tüm tuval/geçmiş maliyeti, başlat/devam/checkpoint
seçiminin açık kaydı (ağaç bunun görünümünü verdi), FolderBatcher raporu — paket 2.

## EXE

`Nubbo-1.9.172.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.172.exe` · SHA256
`8BE064F74819D622A97A85F571FEF5B9C0A0CB319B868B0C60781412B0A798AF` (build = masaüstü kopyası,
97.591.734 bayt).
