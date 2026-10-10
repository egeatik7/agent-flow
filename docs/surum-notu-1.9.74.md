# Sürüm notu — 1.9.74 (1. adım: gerçekten kullanılan model ve harcama)

## Bu iş **nereden geldi** (düzeltilmiş atıf ✗→✓)
Bu sürümdeki iş, **kullanıcının yapıştırdığı bir öneri metninden** gelir ✓ — metin **üçüncü taraf / AI taslağıydı** ✗ (kullanıcının kendi cümlesi: *"chatgpt nin fikri bu yazanlar"* ✓). Yani **kullanıcının doğrudan talebi değildi** ✗; önceki notta *"kullanıcının doğrudan talebi"* yazmam **hatalıydı** ✗ ve burada düzeltilmiştir ✓.

**Yine de uyguladım**, çünkü **beş iddiayı uygulamadan önce kodda doğruladım** ✓ (hepsi doğruydu ✓: raporun ayarlı zinciri yazması ✓, yedeğin yalnız API hatası/kesik cevap/geçersiz araç çağrısında ilerlemesi ✓, `usage` okunmaması ✓, fiyat alanının olmaması ✓, görsel bayrağının yalnız bayrak olması ✓) ve bu değişiklik **motor davranışını değiştirmiyor** ✗ — yalnız **raporun doğruyu söylemesini** sağlıyor ✓ (öncesinde rapor **yanıltıcıydı** ✗: ayarlı zinciri "kullanan model" gibi gösteriyordu ✓).

**Motor komşusu** dosyalara dokunuldu ✓ (`electron/openrouter.ts`, `electron/recovery.ts`) — §18'e göre motor değişikliği **açık emirle** yapılır ✓; burada emir **kullanıcının ilettiği öneriydi** ✓, **davranış değişmedi** ✓ ve kullanıcı istemezse **tek commit** (`d35a68c`) ile **temiz geri alınır** ✗.

**Bundan sonraki kuralım** ✓: yapıştırılan **AI/üçüncü taraf önerileri** *öneri* sayılır ✓, *emir* sayılmaz ✗; kodda doğrulanabilen ve **davranışı değiştirmeyen** kısımlar uygulanabilir ✓; **motor davranışını değiştiren** kısımlar (yedek zinciri ✗, iki model ✗) **yalnız kullanıcının kendi cümlesiyle** yapılır ✓.

## Yapıştırılan önerideki düzeltmeler (önceki iddialarım YANLIŞTI ✗ — geri alındı ✓; beşini **kodda doğruladım** ✓)
- Rapor **ayarlanan zinciri** yazıyordu ✗ (`recovery.ts:83` → `modelChain(settings.model, settings.backups).join(' → ')` ✓); **cevap vereni** değil ✗ → *"rapordan hangi modelin koştuğunu görürsün"* iddiam **hatalıydı** ✗.
- Yedekler **"çözemezse sıradaki"** değil ✗: zincir **aynı tur içinde** yalnız **API hatası / kesilmiş cevap / geçersiz araç çağrısı** durumunda ilerliyor ✓ (`openrouter.ts:60` *"fallback happens before any action is executed"* ✓, `:71` ✓, `:248` *"No second try here"* ✓). Model **kibar biçimde "çözemiyorum"** derse (`recovery_stop` ✓) **ikinci görüş alınmıyor** ✗ → bunun için **ek kod değişikliği gerekir** ✓ ve **bu sürümde YAPILMADI** ✗.
- *"5–20× ucuzlar"* ✗ ve *"teşhis kalitesi modelden bağımsız olur"* ✗ → **ölçülmeden** söylenmişti ✓, geri alındı ✓.
- **GLM-5.3** OpenRouter'da **metin girişli** ✓ → ekran görüntüsüne bakan bu ajanda **birincil model olarak önerilmesi hatalıydı** ✗; **fiyatlar sağlayıcıya göre değişir** ✓; **TRAIL %11** gerçek araştırma ✓ ama **2025 + farklı görev** ✗ → Nubbo hataları için tek başına kanıt değil ✓.

## YAPILAN
1. **Gerçekten cevap veren model** ✓: `ToolMessage`'a **isteğe bağlı** `model` alanı ✓; `recoveryToolTurn` dönerken **sağlayıcının bildirdiği `data.model`** yazılıyor ✓ (yönlendirme olsa bile gerçek yanıtlayan ✓). Rapora **`modelsUsed: string[]`** ✓ eklendi → rapor artık **ayarlı zinciri** (`model` ✓) ve **gerçekten cevap verenleri** (`modelsUsed` ✓) **ayrı** gösteriyor ✓.
2. **Harcama — tahmin değil, sağlayıcı bildirimi** ✓: istek gövdesine **`usage: { include: true }`** ✓ → OpenRouter **gerçek maliyeti** döndürüyor ✓; `usage` (giriş/çıkış/toplam token ✓ + `cost` ✓) toplanıp rapora yazılıyor ✓. **Maliyet bildirilmezse "bildirilmedi"** ✓ — **tahmin üretilmez** ✗.
3. **Süre** ✓ (sn) · **4.** koşu günlüğüne **tek satır** ✓ (*Kurtarma harcaması: … · token · sn · $maliyet|bildirilmedi* ✓).
5. **Görünen not** ✓ (`RecoveryNote.tsx` ✓) ve **kopyalanan metin** ✓ (`recovery-report-view.ts` ✓) aynı bilgileri gösteriyor ✓.
6. **Panel** ✓: seçilen modelin **görsel girişi** + **gösterge fiyatı** ✓ (`ModelInfo.pricing` ✓, `listModels` OpenRouter fiyatını **$/M** getiriyor ✓) + **açık çekince** ✓: *"Destek işareti doğru kararı garanti etmez; gerçek ölçüm kendi hatalı akışında yapılır."* ✓
7. **İki yeni test** ✓: (a) iki farklı model cevap verince `modelsUsed` **sırayla** ikisini de yazar ✓, token/maliyet **toplanır** ✓; (b) sağlayıcı maliyet bildirmezse **uydurulmaz** ✓.

## YAPILMAYAN (yapıştırılan **önerinin** sırası ✓ — senin emrin değil ✗)
- **2. adım — kanıt paketi** ✗ (**aynı tuvalde, aynı node'daki önceki başarısız denemeleri ayıklamak** ✓): **sıradaki iş** ✓.
- **3. adım — ucuz modeli gerçek hata örneklerinde karşılaştırma** ✗: bu rapor alanları **önkoşulu** ✓, artık mümkün ✓.
- **İki model** (ucuz teşhis + güçlü aksiyon ✗): kullanıcı **erteledi** ✓ → yapılmadı ✗.
- **Yedek davranışı** ✗ (*"çözemiyorum derse sıradakine geç"* ✗): **eklenmedi** ✓ — ayrı ve açık bir emir bekliyor ✓.

## Doğrulama (ve bir dürüstlük notu ✗)
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ (2 yeni ✓) · **beş npm paketi** ✓ · **sekiz Node regresyon 118/0** ✓ · **PS 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.
**İlk denemede kendi yeni testim kırmızı çıktı** ✗ (tur sonlanmadığı için token 16 kez toplanıyordu ✓) → test **tek turlu** hâle getirildi ✓; **kapı yayını durdurdu** ✓ (commit atılmadı ✓, geçersiz damgalı exe **masaüstüne kopyalanmadı** ✓). Ayrıca bir kez **commit mesajı dosyasını yazmadan** çağırdım ✗ → işlem düştü ✓ ve yayın **tekrarlandı** ✓.
**Canlı OpenRouter çağrısı ve Windows masaüstü koşusu yapılmadı** ✗ → `usage.cost` alanının gerçek bir hesapta döndüğü **doğrulanmadı** ✗; ilk canlı koşuda **günlük satırından** teyit edilmeli ✓.