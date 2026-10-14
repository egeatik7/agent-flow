# Görsel hedefleme: computer_use çıktı sözleşmesi

Bu, `nubbo-tum-ayarlar-otomatik-kayit.patch` üzerine ek patch'tir. Public taban tekrar kontrol edildi: `1849192` / 1.9.135. Kullanıcının logundaki 1.9.136 public main'de yok; Cursor o çalışma ağacındaki değişikliklerle diff'i birleştirmelidir. Reset/force uygulama, mevcut node/akış JSON'larını yeniden yazma. Bu pakette sürüm, commit/push ve EXE üretimi yok.

## Yeni davranış

GUI-Owl ve diğer UI-TARS olmayan görsel modellerin hedefleme aşaması, araç çağrısını doğrudan ortak sonuç nesnesi olarak kullanır:

```xml
<tool_call>{"name":"computer_use","arguments":{"action":"mouse_move","coordinate":[66,137]}}</tool_call>
```

Hedef yok, örtülü veya belirsizse:

```xml
<tool_call>{"name":"computer_use","arguments":{"action":"terminate","status":"failure"}}</tool_call>
```

`name/arguments/action/coordinate` motor boyunca taşınır. GUI-Owl cevabı eski `intent/x/y` nesnesine çevrilmez. Koordinat çifti 0–1000 ekran ızgarasındadır; gerçek ekranın boyutu ve başlangıç konumuyla yalnız fiziksel fare koordinatı hesaplanır. `terminate/failure` bu hedefin bulunamadığıdır; bütün akışın tamamlandığı veya durdurulduğu anlamına gelmez.

Nubbo `mouse_move` cevabını alınca kendi motoruyla fareyi taşır. Mevcut bağımsız imleç kontrolü onaylarsa node'un seçili sol/sağ/çift tıklaması gönderilir. Modelden gelen doğrudan tıklama, tuş, yazma, scroll veya başka araç bu aşamada reddedilir. Move-only node tıklamaz. Salt okunur önizleme fareyi oynatmaz. İmleç kontrolünün `confirm/adjust/uncertain` protokolü değişmedi.

Tek XML `tool_call` veya aynı nesnenin eksiksiz JSON/fence gösterimi kabul edilir. Resmî cookbook'taki tek satırlık `Action:` açıklaması desteklenir; çoklu çağrı, başka araç, ek alan, tekrarlanan/escaped tekrarlanan anahtar, eksik/fazla koordinat, sayı yerine metin ve sınır dışı nokta reddedilir. Koordinat uydurulmaz, bozuk alan adları düzeltilerek tıklama çıkarılmaz.

XML cevabıyla çatışan `response_format: json_object` yalnız görsel hedefleme isteğinden kaldırıldı. Diğer LLM çağrıları, üretim parametreleri ve model listeleri değiştirilmedi. Kullanıcının kayıtlı ek promptları silinmedi; son sözleşme, çelişen eski çıktı örneklerinden öncelikli olduğunu açıkça söyler.

UI-TARS'ın özel native cevabı ve mevcut popup akışı korunur; yalnız motor sonuç nesnesinin yeni biçimine aktarılır. GUI-Owl/ortak computer_use hedeflemesinde **otomatik popup kapatma yoktur**: örtülü hedef failure'dır. Node'un açık talimatı popup kapatma düğmesini hedefliyorsa o düğmeye mouse_move önerilebilir. Bu fark, kabul edilen yalnız iki eylem sınırının sonucudur.

## Dayanak ve kapsam

Resmî kaynak: https://github.com/X-PLUG/MobileAgent/blob/main/Mobile-Agent-v3.5/grounding_and_kb/eval_grounding_benchmarks.py

Araç adı, XML sarmalayıcısı, `action/coordinate` ve 1000 ölçeği bu kullanım yoluyla uyumludur. Nubbo yalnız hedef bulduğu için izinler daha dar tutuldu; resmî tam agent'ın bütün araçları açılmadı. Yeni biçimin gerçek Q4_K_M modelde daha başarılı olduğu bu ortamda ölçülmedi; bu bir uyumluluk düzeltmesi, kalite garantisi değildir.

Eski tanılama kayıtlarının offline replay'i ayrıca desteklenir; o geriye dönük uyarlama üretim cevaplarında kullanılmaz. Recovery Node harness'inde aynı hedefin hem iç resolver hem dış aşama tarafından kaydedildiği mevcut çift trace, iki tıklama sanılmadan tek benzersiz hedef olarak doğrulanır.

## Uygulama ve doğrulama

Önceki otomatik kayıt patch'i uygulanmış tabanda:

```sh
git apply --check nubbo-gorsel-computer-use-format.patch
git apply nubbo-gorsel-computer-use-format.patch
npm run typecheck
npx vitest run
npm run build:electron
node --test scripts/test-input-recovery.cjs scripts/test-targeting.cjs scripts/test-stability-agent.cjs scripts/test-stability-main.cjs
```

Cursor 1.9.136'da çakışmayı elle birleştirsin; özellikle eski VisualTargetResult tüketicilerinin `intent/x/y` yerine `arguments.action/coordinate` okuduğunu kontrol etsin. Sonrasında Windows'ta yeni kaynaktan EXE üretip Blender simgesi ve User Perspective üzerinde aynı ekranlarla denesin. Ham cevap, nokta, model, ek deneme ve imleç kararını logdan raporlasın.

- İlgili Vitest: 10 dosya / 124 test geçti, unhandled hata yok.
- Tam Vitest: 1147 geçti, 4 başarısız, 5 skip; unhandled hata yok. Tam koşu yeşil değildir. Dört başarısızlık önceki tabanda da vardı: iki `badge-id-resolution` beklentisi, Chrome kurulumu olmadığından iki `render-overflow-audit` testi.
- Typecheck ve renderer + main kaynak build'i geçti.
- Node recovery/targeting/stability-agent/stability-main: 65 geçti, 21 mevcut skip, 0 başarısız.
- Gerçek Windows/Ollama ve yeni EXE denenmedi. İlgili başarılar taklit HTTP ve native köprülerle ölçülen protokol/entegrasyon doğrulamasıdır.
