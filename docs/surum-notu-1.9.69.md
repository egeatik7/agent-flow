# Sürüm notu — 1.9.69 (Nubbo 1.9.63 hata düzeltmeleri: 5 düzeltildi, 2 AÇIK)

Kaynak: `Nubbo-Bug-Duzeltmeleri-1.9.63`. `KURULUM.txt`: **`update.patch`** → **1.9.62 (`45f1c1a`)** üzerine ✓
(= benim 1.9.68 içeriğim ✓); `cumulative` → `6edcdcc` ✓. `update`'in düz `--check`'i **`package.json` +
`package-lock.json`** yüzünden düştü ✗ → ölçtüm: **tek fark sürüm satırı** ✓ (1.9.62 → 1.9.63 ✗) →
o iki dosyayı **hariç tutarak** uyguladım ✓ (`--check` paket-haric = **0** ✓), **zorlama yok** ✗;
`git diff --check` **0** ✓; `cumulative` **uygulanamaz** ✗ (taban daha yeni ✓, README çakışıyor ✗) → kullanılmadı ✗.

## DÜZELTİLEN 5 HATA (kaynağın kendi raporu)
1. **Çalışırken tuval düzenlenebiliyordu** ✗ → **düzeltildi** ✓: `NodeCanvas`'ın **sürükleme, üyelik,
   bağlantı, silme, ekleme, kopyalama ve paket çıkarma** işlemleri **canlı kilit** kontrolü yapıyor ✓;
   çalıştırmadan önce **başlamış** sürükleme/bağlantı girişimleri **iptal** ediliyor ✓;
   **gezinti/seçim** ve **motorun durum güncellemeleri** çalışmaya devam ediyor ✓.
2. **Paket içinde aynı dosyadan devam bilgisi kayboluyordu** ✗ → **düzeltildi** ✓: `resumeLoopId` ve
   `resumeItem` hem **paket yolundan girişte** hem **normal paket çağrısında** aktarılıyor ✓; listeye
   **yeni dosya eklenmiş olsa bile kayıtlı dosyadan** devam ediliyor ✓; kimlik bulunamazsa **durma**
   davranışı korunuyor ✓.
3. **Açık tuval kopyaları birbirinin kaydını eziyordu** ✗ → **düzeltildi** ✓: kaydetmeden önce sekmenin
   **açılış/kayıt baz çizgisi** güncel depoyla karşılaştırılıyor ✓; **çakışmada yeni kayıt
   değiştirilmeden** hata gösteriliyor ve **yerel sekme korunuyor** ✓; **kapatırken** aynı çakışma
   kapanmayı **durduruyor** ve günlüğe yazılıyor ✓.
4. **Klasör güncellemeleri birbirini iptal ediyordu** ✗ → **düzeltildi** ✓: zamanlayıcı ve güncelleme
   kimliği **tuval/node başına** ✓; iki farklı klasör **bağımsız** yenileniyor ✓; aynı node'un **eski
   yanıtı yeni isteği ezemiyor** ✓; tuval değişmişse sonuç **başlatıldığı sekmeye** uygulanıyor ✓;
   bileşen kapanınca bekleyen işler geçersizleşiyor ✓.
5. **Chrome arka plan sekmeleri hedeflere karışıyordu** ✗ → **düzeltildi** ✓: DOM koordinatları yalnız
   **görünür ve odaklı** sayfadan toplanıyor ✓; toplama sırasında **sekme değişirse** sonuç **atılıyor** ✓;
   kontrol başarısızsa o sayfadan **hedef üretilmiyor** ✓, diğer okuma yolları devam ediyor ✓.

## AÇIK BIRAKILAN 2 HATA ✗ (bilinçli — "programı bozma riski" gerekçesiyle)
- **Koşullu paket çıkışı** ✗: paket içindeki koşul yanlış dala gitmese bile **paket dış devamı koşulsuz**
  çalışıyor ✗ → **bu davranışa bağlı koşulları paketlemeyin** ✗.
- **İç içe döngüde iç node'dan devam** ✗: en dış döngüden açılan yürütmede **seçilen iç node** aşağı
  aktarılmıyor ✗ → **iç node'dan devam etmeyin** ✗ (adım tekrarlanabilir ✓).
- **Kayıt çakışması** için geçici yol ✓: güncel tuvali **Tuvaller → yeni sekmede aç** ✓ veya **Dışa Aktar** ✓
  (yerel düzenleme otomatik birleştirilmez ✗).

## Doğrulama — paketin kaynağıyla birebir
- **7/7 dosya «İÇERİK AYNI»** ✓ (`browser.ts` ✓, `canvas-library.ts` ✓, `runner.ts` ✓, `App.tsx` ✓,
  `NodeCanvas.tsx` ✓, `test-stability-bridge-browser.cjs` ✓, `bug-duzeltmeleri-1.9.63.md` ✓);
  **`package.json`: tek fark sürüm satırı** ✓ (ölçüldü ✓).
- `typecheck` ✓ · `build:electron` ✓ · **Vitest 77 dosya / 558 test** ✓ (paketin 553'ü + Windows'a bağlı
  5 atlamanın tamamı ✓) · **beş npm paketi** ✓ · **sekiz Node regresyon dosyası 117/0** ✓
  (köprü-tarayıcı paketi dahil ✓) · `pack:win` ✓ · exe hash ✓.

## Değişmeyenler
**XP görünümü** ✓ ve **Kurtarma Ajanı** ✓ korunuyor ✓; kullanıcının **mevcut tuval dosyaları ve ayarları**
topluca dönüştürülmüyor/silinmiyor ✓.

## Doğrulanmayan (dürüst)
- **Canlı Windows masaüstü, kullanıcı Chrome profilleri, ONNX çalışma zamanı ve uzun süreli gerçek
  otomasyon denenmedi** ✗ (paketin de yazdığı sınır ✓); testler masaüstü girdisini ve Chrome bağlantısını
  **kontrollü nesnelerle** sınıyor ✓.
- **Sıfır risk iddiası yok** ✗; **2 açık hata yukarıda** ✗ ve **2 orta öncelikli bulgu** bu yamanın
  kapsamına **alınmadı** ✗ (paketin açık beyanı ✓).