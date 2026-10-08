# Sürüm notu — 1.9.50 (Nubbo_Initiative_Policy_Fix)

Kaynak: kullanıcının `Nubbo_Initiative_Policy_Fix` paketi (taban `45e83bb` = v1.9.49).
Ters kontrol başarısız (henüz uygulanmamış) → düz kontrol başarılı → **zorlamadan** uygulandı ✓;
`git diff --check` temiz ✓; **5 dosya** ✓ (`electron/agent.ts`, `electron/llm-flow.ts`,
`electron/openrouter.ts`, `scripts/test-input-recovery.cjs`, `tests/initiative-scope.test.ts`).

## Değişen davranış (paketin metni)
1. **Gömülü UI-TARS promptu** artık geniş bir plan istemiyor; yalnız **mevcut node'un eksik sonucunu
   veya tamamlandığını** söyletiyor. JSON ekran promptundaki *"short plan"* ifadesi bu node için kısa
   gerekçeye çevrildi; **liste motorunun** gömülü promptu da aynı görev sınırını belirtiyor.
2. Türkçe **yasaklar açıkça** yazıldı: *"yeni profil oluşturma"*, *"sırasını değiştirme"*,
   *"üretimi başlatma"* bunlar **görev değil, yasak**tır; görev bitince `finished`/`done` istenir.
   (Bu bir prompt talimatıdır; modelin her zaman uyacağının garantisi değildir.)
3. **Ekran İnisiyatif'inde model sırası değişti**: kullanıcının yapılandırdığı **UI-TARS dışı** ajan
   modelleri önce denenir — örn. `UI-TARS → Luna → DeepSeek` zinciri bu node türünde
   **`Luna → DeepSeek → UI-TARS`** olur. Ayar dosyası değişmez; UI-TARS dışındaki modellerin kendi
   aralarındaki sıra korunur. Yalnız UI-TARS yapılandırılmışsa o kullanılır. **Normal Tıkla/hedef bulma
   sırası aynı kalır.** Daha önce yedekte kalan model artık çağrılır; **yeni model veya anahtar eklenmez**.
4. **Gerçek kullanıcı özel promptları korunur**; tam olarak eski gömülü metne eşit varsayılanlar bu
   kullanımda yeni gömülü metni alır; ortak görev/olumsuzluk kuralları özel promptlara da eklenir.

Eklenmeyenler: yeni tamamlanma yargıcı, ikinci "bitti mi?" çağrısı, hedefe göre regex ile otomatik
bitirme, Chrome'a özel yürütme kodu. **Fareyi konumlandırma → sonraki turda modelin kendi tıklaması**
davranışı korunur. Yazma, OCR, worker ve döngü motoruna **dokunulmadı**.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest 45 dosya: 297 test geçti, 0 atlandı** ✓ (paketin 5 atladığı test burada **çalıştı** ✓)
- **Derlenmiş motor Node paketleri: 94 pass / 0 fail** ✓ (paketin bildirdiği 94 ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓ (bu paket .ps1'e dokunmadı ✓; regresyon için koşuldu ✓)
- Kod kanıtı ✓: `electron/agent.ts` — *"İnisiyatif görev kararı için yapılandırılmış görsel model öne
  alındı"* ✓ ve günlükte `… , UI-TARS yedek` ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Gerçek Windows masaüstü, canlı Chrome profil seçimi ve canlı UI-TARS/Luna/DeepSeek istekleri
  denenmedi** ✗ (paketin de yazdığı sınır ✓). Geçen testler **modelin uyduğunu kanıtlamaz** ✗.
- Canlı kabul: eski Nubbo oturumunu kapatıp **1.9.50**'yi aç ✓ → aynı profil node'unu bir kez koş ✓ →
  logda **Luna/DeepSeek'in öne alındığını** ve **UI-TARS'ın yedekte** kaldığını gör ✓; modelin bitiş
  kararını ekranla **ayrıca** karşılaştır ✓.
- Önerilen node metni (akıştaki gerçek değişken adıyla ✓): *"Açılan profil seçicide soldan {{sıra}}.
  mevcut profili aç. Profilin tarayıcı penceresi açıldığında görevin biter. Diğer pencerelere dokunma."*
  — **bu metni akışına ben yazmadım** ✓ (patch mevcut node komutlarını değiştirmez ✓).