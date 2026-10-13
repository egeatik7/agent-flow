# Sürüm notu — 1.9.129 (bağlam ölçümü kartta görünür + Android aktarımı)

**Taban:** `2c39c86` (1.9.128). Bu sürüm, önceki oturumun **yarım bıraktığı** bağlam göstergesini
tamamlar. Önceki commit ölçümü istek akışına bağlamıştı ama **kart, renderer ölçümü ve Android
aktarımı yapılmamıştı** — kart bu yüzden görünmüyordu.

## Kullanıcının gördüğü sonuç

- Masaüstü kartında **“Yüklü bağlam: 32.768 token”**.
- Altında ayrıntı: **azami kapasite**, **yapılandırılmış pencere**, **gönderilen num_ctx**, ölçüm zamanı.
- Ölçüm yoksa **“bilinmiyor”** (+ “ölçülemedi · kırpma iddiası yok” rozeti), **eskiyse “eski ölçüm”**.
- **Gerçek giriş tokenı** (`usage.prompt_tokens` / Ollama `prompt_eval_count`) ile **tahmin** (“TAHMİN”)
  açıkça ayrı yazılır.
- Mevcut **kronometre** ve **aşama şeridi** korunur; kart taşmaz (bağlam bloğu kendi grid satırında,
  içerik gerekirse kaydırılır — komşu satıra binmez).
- Aynı yapılandırılmış veri **Android izleyiciye** aktarılır (masaüstüyle aynı nesne, aynı satırlar).

## Düzeltilen gerçek kusurlar

1. **Yakalanmayan test hataları (`unhandled errors`).** Kaynak: `tests/local-endpoint.test.ts` içindeki
   sahte sunucu **her** isteği üretim isteği sayıyordu; ölçüm sondasının gövdesiz `GET /api/ps` isteği
   `expect(req.url).toBe('/v1/chat/completions')` ile, `POST /api/show` ise boş gövdeyi `JSON.parse('')`
   ile fırlatıyordu. Önceki raporun **finally/abort açıklaması yanlıştı.** Sonda uçları artık ayrı
   yanıtlanır ve her test sonunda bekleyen ölçüm işi boşaltılır.
2. **Cevap sonrası ölçüm hiç yapılmıyordu.** Cevap sonrası tazeleme, uçuştaki *istek sınırı* sondasıyla
   birleşiyor (`coalesce`) ve modelin **yeni yüklenmiş** penceresini göremiyordu; ikinci `/api/ps`
   isteği hiç gitmiyordu. Artık cevap kanıtı taşıyan tazeleme uçuştaki sondayı bekler, sonra
   **gerçekten yeni** sorgu yapar.
3. **Kanıtsız tazelik.** Hiçbir sonda cevap vermezse ölçüm “şimdi ölçüldü” damgası almaz; yüklü pencere
   geçersiz sayılır, statik bilgi ve damgası korunur.
4. **Sıra koruması.** Kartın son cevap ölçümünden eski damgalı cevap olayı yeni kartı **ezmez**
   (zincirde önceki modelin gecikmiş sondası).

## Sınır (dürüst)

- **Canlı Windows/Ollama denemesi YAPILMADI.** Bu makinede **Electron hiç başlamıyor** (`electron
  --version` bile `0x80000003` ile çöküyor), gerçek Ollama sunucusu da yok. Ölçüm yolu **gerçek HTTP
  sunucusu + fetch taklidiyle** sınandı; gerçek model yüklemesi ölçülmedi.
- Kart görseli gerçek **bileşen + gerçek CSS** ile headless Chrome'da, HUD'nin tam ölçüsünde (456×196)
  ve telefon ölçüsünde (390×844) çizildi; ölçülen piksel sonuçları: `sayfaTasmasi=0`,
  `satirBiniyor=false`, tüm bağlam satırları kırpılmıyor.
- `electron/send-log.ts` içindeki eski `baglamKapasitesi` önbelleği üretimde artık kullanılmıyor ama
  dosyada duruyor (istenmeyen refactor yapılmadı).
- Bilinen teslim dışı bulgu: `tests/zip-library-storage.test.ts` tam koşuda ara sıra düşüyor
  (`ZipLibraryConflictError`); tek başına 4/4 geçti, temiz HEAD'de de bir kez görüldü — bu
  değişikliklerle ilgisi yok.

## Doğrulama

- `npm run typecheck` ✓ 0 hata.
- `npx vitest run` → **135 dosya / 1014 test geçti / exit 0**, **yakalanmayan hata yok**
  (temiz HEAD'de aynı koşu 2 unhandled hata ile exit=1 veriyordu).
- Beş Node paketi: `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- **12 PowerShell harness** → 12/12 geçti.
- `npm run build:electron` ✓ · `npm run pack:win` ile paketlendi.
