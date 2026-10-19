# Sürüm notu — 1.9.162 (gözlemlenebilirlik işi durdurmaz + koşu/rapor dürüstlüğü)

**Taban:** `bbfb42a` (1.9.161). Node türleri, parametreleri, çıkışları ve kullanıcı akışları
**değişmedi**; düzeltmeler hata davranışı ve raporlama sınırında.

Bu sürüm, 20 Ekim 2026 tarihli 40 ajanlık hata taramasının (`docs/bug-taramasi-1.9.161.md`)
P0/P1 kümesinin ilk partisidir.

## Ne değişti

1. **Checkpoint yazımı koşuyu öldürmüyor** (`runner.ts`, `main.ts`). Diskte EPERM/EBUSY/ENOSPC
   olduğunda koşu checkpoint'siz sürer, ilk hatada bir kez uyarır. Ayrıca `write` artık
   EPERM/EBUSY/EACCES için sınırlı yeniden dener ve yarım `.tmp` bırakmaz. Eski davranış
   `tests/checkpoint-runner.test.ts` içinde "koşu reddedilir" diye kilitliydi; tersine çevrildi.
2. **Checkpoint saklama sınırı** (`checkpoints.ts`): koşu bitince en yeni **400** checkpoint çifti
   tutulur, 7 günden eski ve 1 günden eski `.tmp` artıkları silinir. `list()` tek bozuk/kilitli
   dosya yüzünden tüm geçmişi düşürmez; `detail()`/`snapshot()` anlaşılır hata verir.
3. **Eylem dışı node hataları kalıcı** (`runner.ts`): boş Koşul metni, uyumsuz hedef, kaldırılmış
   node türü ve **paket içinden sızan hata** artık sonsuz 3 sn'lik yeniden denemeye düşmez. Paket
   yeniden oynatılmadığı için içindeki tıklama/yazma ikinci kez gönderilmez.
4. **Koşul turu sınırlı** (`method-cycle.ts`, `agent.ts`): okuyucu/model kalıcı hata verirse en çok
   4 taze gözlemden sonra karar runner'a (kurtarma) devredilir; 1.9.154'ün "karar verilemedi"
   yolu artık gerçekten çalışır. `maxRounds` vermeyen çağıranlarda davranış aynı.
5. **Görsel tıklama uyarısı yutulmuyor** (`a11y-bridge.ts`, `agent.ts`): worker "pencere değişti"
   durumunda tıklayıp uyarı döndürüyor; uyarı artık günlüğe yazılıyor (kardeş yollar gibi).
6. **Modelin kapatma/silme tuşları gerçekten engelli** (`key-guard.ts` bağlandı): `act.key` aracı ve
   kurtarma/Yap eylemi `alt+f4`, `ctrl+w`, `ctrl+q`, `shift+delete`, `delete` kombinasyonlarını
   reddeder. Kullanıcının kendi Tuş Gönder node'u etkilenmez.
7. **`run.from` başlamayan koşuya "başladı" demiyor** (`tools.ts`): hazırlık hatası bir tick içinde
   görülüp açık ret dönüyor; ajan önceki koşunun sonucunu bu koşunun sonucu sanmıyor.
8. **Durdurulan koşunun sayaçları korunuyor** (`main.ts`): durdurma sonucu `steps` ve `failed`
   taşır; "0 adım · hatalı öğe yok" çelişkisi bitti.
9. **Merge belirsizliği metinden tahmin edilmiyor** (`main.ts`, `tools.ts`): 20 sn zaman aşımı artık
   `ambiguous: true` döndürür; "hiçbir şey yazılmadı" yalnız pencere bunu kanıtladığında denir.
10. **Hatadan devam, klasörden dolan listede yanlış reddetmiyor** (`tools.ts`): koşu-anı öğesi
    bilinmiyorsa (klasör kutusu) karşılaştırma yapılmaz; kimlikle devam motorun denetiminde kalır.
11. **Kütüphane kilidi kendi kaydını bırakabilir** (`library-lock.ts`): unlink EPERM alırsa sınırlı
    denenir, kalıcı başarısızlık hata fırlatmaz ve kayıt `held`'de kalır; kendi PID'imizle kalmış
    eski kilit (çökme) oturumu kilitlemez.
12. **Tanılama kanıtı budanıyor** (`send-log.ts`): `%APPDATA%` altındaki istek klasörleri en yeni
    200 ile sınırlanır, 7 günden eskiler silinir (ölçülen: 2169 klasör / ~210 MB).
13. **Yap giriş bütçesi birimi düzeltildi** (`yap-context.ts`, `openrouter.ts`): bayt tahmini token
    penceresiyle kıyaslanıyordu; artık 2 bayt/token varsayımıyla çevrilip kıyaslanıyor. ≤8192
    pencereli yerel modelde istek hiç gönderilmiyordu.
14. **Kapanışta kullanıcı diyaloğu çöpe atılmıyor** (`window-close.ts`, `main.ts`, `preload.ts`,
    `App.tsx`, `types.ts`): arayüz kapanış isteğini işlerken 2 sn'de bir "hâlâ çalışıyorum" der ve
    main'in 10 sn'lik sayacı tazelenir. Arayüz çökerse/asalarsa sayaç yine dolar.
15. **Portable çıkarma klasörü sahipleniliyor** (`instance-marker.ts`, `temp-sweep.ts`, `main.ts`):
    çalışan örnek kendi klasörüne PID işareti yazar; başka bir Nubbo açılışta o klasörü "10
    dakikadan eski" diye silmez (saatlerce süren koşu düşüyordu).

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **193 dosya / 1471 test**; yeni dosyalar: `checkpoint-retention` (5),
  `runner-terminal-errors` (5), `model-key-guard` (17), `resume-item-check` (4), `library-lock-release`
  (4), `evidence-retention` (3), `window-close-heartbeat` (3), `yap-budget-units` (5),
  `instance-marker` (3). Bilinen flaky: `tests/zip-library-storage.test.ts` "unchanged explicit save"
  (Windows `rename` EPERM; 1.9.150'den beri belgeli, F2 kullanıcı kararıyla kapalı). Tam pakette
  1 kırmızı görüldü, tek başına 27/27 geçti.
- Node paketleri: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 — **0 kırmızı**.

## Sınırlar (dürüst)

- Canlı Windows masaüstü/Blender koşusu **yapılmadı**; bu partide worker.ps1 giriş yoluna
  dokunulmadı.
- PowerShell harness'leri bu partide yeniden koşulmadı (giriş katmanı değişmedi); 1.9.160 notundaki
  4 bilinen kırmızı aynen geçerli.
- Taramadaki kalan orta/düşük bulgular (ör. `screen.ps1` piksel döngüsü, `send-log` boyutu,
  `ensureActed` tarama koruması, koşul ikinci bakışı) sonraki patch'lerde ele alınacak.
