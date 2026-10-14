# 1.9.139 — yöntem geçişi ve güvenli girdi sınırı

Taban: public main `0bfc324`, sürüm 1.9.139. Bu patch doğrudan bu tabanın üzerine uygulanır; önceki 1.9.135 patch paketlerini ayrıca üst üste uygulamak gerekmez. Mevcut değişiklikler varsa Cursor diff'i birleştirsin; reset/force kullanmasın. Sürüm/EXE/commit/push bu turda üretilmedi.

## Sorun ve sonuç

Görsel LLM noktayı bulduğunda hedef çözümleyici dönüyordu. Sonraki imleç kontrolü `uncertain` verince yöntem listesi çoktan kapanmış olduğu için UIA/OCR denenmiyordu. Döngü bunu sıradan öğe hatası sayıp sonraki gruba geçebiliyordu. Kullanıcının logunda 02 grubundaki Watcher tıklamasının reddi ardından 03 grubunun Blender açma adımları bu şekilde başladı.

Artık tıklama **henüz gönderilmemişken** görsel onay reddedilirse yalnız sıradaki açık yöntemler yeni taramayla denenir. Örnek: `Görsel → UIA → Windows+ONNX OCR → Liste`. UIA hedefi bulursa tek input gönderilir; bulamazsa OCR/list devam eder. Görsel yönteme baştan dönülmez, önceki yöntemler tekrar denenmez, kapalı yöntemler açılmaz. Orijinal node komutu, sol/sağ/çift tıklama modu ve akış JSON'u korunur.

`uncertain`, iki görsel düzeltmenin sonuç vermemesi veya geçersiz model düzeltmesi güvenli yöntem reddi olabilir. Stop, fare hareketi/drift, kilit, fatal API hatası ve popup/girdi gönderimi sonrası belirsizlik aynı şekilde ele alınmaz; bunlarda başka yöntemle yeniden basılmaz. Native click çağrısı, fallback'in yakaladığı onay bloğunun **dışındadır**. Native çağrı başladığında sonucu belirsizse girdi gönderilmiş olabileceği işaretlenir.

## Diğer kapanan yollar

- Chrome, yazılı UIA, kayıtlı UIA ve ortak okuyucunun sıradan çalışma hataları, sonraki etkin yöntemi gereksiz yere kesmez. Son başarılı yöntem bulunmadan girdi gönderilmez. Stop ve tanılama kaydının eksikliği gibi terminal durumlar hedef yokmuş gibi yutulmaz.
- Yaz node'unun görsel hedefi, Tıkla ile aynı mevcut imleç kapısından geçer. Gerekirse aynı kalan yöntemlere başvurur; alan seçilemeden temizleme/metin gönderilmez. Hedefsiz Yaz'ın mevcut doğrudan odak davranışı korunur.
- Takılma planının `lookFor` metni artık node'un orijinal komutunun yerine konmaz. Bekleme/devam planı yeni arama başlatabilir, fakat başka hedefte orijinal node'u başarılı sayamaz.
- Bütün hedefleme yöntemleri tükenirse `haltLoop` işaretli hata oluşur. Runner **önce açık Recovery'ye fırsat verir**; hata çözülmezse döngü mevcut öğede durur, sıradaki klasör/gruba geçmez. Başarılı Recovery kararı verilirse mevcut öğeden devam edilir. Diğer, hedeflemeyle ilgisiz sıradan öğe hatalarının mevcut döngü politikası değiştirilmedi.
- Native tıklama/yazma/Enter çağrısı hata verirse ve tıklama sonrası gözlem hata verirse `inputMayHaveBeenSent` bilgisi kaybolmaz. Recovery bunu orijinal node için alır; kör `recovery_retry` ve aynı hata node'una `step_run` yeniden gönderimi engellenir. Güncel ekranı okuyup araçla düzeltme ve `recovery_complete` yolu açık kalır.
- Offline eski kayıt replay'i, eksik kaydı açık terminal hata olarak raporlamaya devam eder. Gerçek ekran gözlemi uydurulmaz.

## Tekrar ve süre kapsamı

Normal hedef aramasında mevcut sınırlı yeni-ekran tekrar hakkı korunur: ilk aramadaki etkin yöntemler sonuç vermezse 3 saniye sonra yeni tam-ekran araması; mevcut takılma planı da yalnız orijinal hedef için sınırlı yeni arama yapabilir. Pointer reddinden sonraki devam ise kalan yöntemlere yönelir ve görsel yöntemi yeniden başlatmaz. Bu patch genel model zincirinin 15 dakikalık bütçesini veya worker kuyruklarının Stop sözleşmesini yeniden yazmaz.

Kayıtlı konum/offset hâlâ tek başına tıklama kanıtı değildir. Koşul node'unun bağımsız UIA→OCR davranışı ve move-only/salt okunur önizleme davranışları korunur. Yeni Blender açılışı veya genel tıklama-sonrası başarı doğrulaması eklenmedi. Promptlar, LLM üretim gövdeleri/ayarları ve kaydedilmiş node/akış şemaları değiştirilmedi.

## Değişen dosyalar

`electron/agent.ts`: kalan yöntem metadatası, yeni okuyucu gözlemi, yöntem hatası sınırı, Click/Type onay/fallback yolu ve gönderim işareti.

`electron/visual-hover.ts`: güvenli model reddini diğer imleç hatalarından ayırır. `electron/runner.ts`: hedefleme tükenince aynı öğede durma. `electron/recovery.ts`: orijinal gönderim işaretini alır. `scripts/replay-target.cjs`: eksik eski kaydı terminal olarak korur. Yeni `tests/method-fallback.test.ts` ve Recovery regresyon testi.

## Cursor'da uygulama

```sh
git apply --check nubbo-yontem-fallback-139.patch
git apply nubbo-yontem-fallback-139.patch
npm run typecheck
npx vitest run tests/method-fallback.test.ts tests/visual-pointer-agent.test.ts tests/visual-pointer.test.ts tests/visual-target.test.ts tests/runner-loop.test.ts tests/runner-fail-edge.test.ts tests/ocr-stage-migration.test.ts tests/recovery.test.ts tests/recovery-runtime.test.ts tests/recovery-pointer.test.ts tests/target-match.test.ts
npm run build:electron
node --test scripts/test-input-recovery.cjs scripts/test-targeting.cjs scripts/test-stability-agent.cjs scripts/test-stability-main.cjs
npx vitest run
```

Mevcut branch değişmişse aynı davranışı güncel kaynakla birleştir. Windows'ta yeni kaynaktan EXE üret; aynı Watcher ekranında GUI `uncertain` → UIA veya OCR → yalnız bir gerçek tıklama zincirini doğrula. Bütün yöntemler kapalı/yetersizken 02 öğesinde kaldığını, Recovery açıkken önce kurtarmanın çalıştığını kontrol et. Ham model yanıtları ve `[Yöntem geçişi]` kayıtlarıyla sonucu raporla.

## Doğrulama ve sınırlar

- Typecheck: geçti. Renderer + Electron main kaynak build'i: geçti.
- İlgili Vitest: 11 dosya / 128 test geçti; unhandled hata yok.
- Yeni testler `uncertain→UIA`, `UIA→OCR`, farklı sıra, kapalı aşamalar, sınırlı düzeltme, bozuk model cevabı, Chrome/UIA/okuyucu hatası, taze tarama, Type geçişi, gönderim-sonrası hatada yeniden basmama, Stop, fare hareketi, fatal API, move-only, preview, aynı öğede durma, Recovery devreye girişi ve orijinal komutun korunmasını kapsar.
- Tam Vitest: 1168 geçti, 4 başarısız, 5 skip; unhandled hata yok. Tam koşu yeşil değildir. Aynı 4 hata temiz 1.9.139 tabanında ayrıca kontrol edildi: iki `badge-id-resolution` beklentisi ve Chrome kurulumu olmadığından iki `render-overflow-audit` testi.
- Native Node recovery/targeting/stability-agent/stability-main: 65 geçti, 21 mevcut skip, 0 başarısız.
- Gerçek Windows/Ollama ve yeni EXE denenmedi. Taklit model/bridge testleri canlı GUI başarısı değildir.
- Önceki mimari raporun tüm maddeleri çözüldü iddiası yok: genel worker kuyruğu/Stop, ortak toplam zaman bütçesi, Yap gözlem tazeliği ve HUD süre kaynakları bu patch'in dışında kaldı. Recovery sırasında sonradan çağrılan diğer izinli node'ların bütün gönderim geçmişi için genel bir ledger eklenmedi; burada orijinal hata node'unun bilinen/olası gönderimi korunur.
