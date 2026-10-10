# Sürüm notu — 1.9.79 (yerel model desteği: **aynı listede** OpenRouter + `local:model`)

Kullanıcının **açık onayı** ✓: *"okey böyle yap … yerel model için de ayrı tuş ekle gerekli yerler değişsin ama aynı anda hem openrouter modelleri hem de yerel model seçilebilir olsun listeden, yerel modeli aşağı yukarı alabileyim."*

## Tasarım (en az müdahale ✓)
Zincirdeki bir satır **`local:<model>`** yazarsa istek **yerel adrese** gider ✓; **diğer her satır OpenRouter'da kalır** ✓.
Böylece **`model` alanı string kalır** ✓ → **eski JSON'lar bozulmaz** ✓ ve `ModelChain`'in **hazır ↑ ↓ ×** tuşları
**aynen** çalışır ✓ → kullanıcının *"yerel modeli aşağı yukarı alabileyim"* isteği **ek iş gerektirmedi** ✓✓.

## Gelen
1. **`electron/openrouter.ts`** ✓: `setLocalEndpoint(url)` ✓ (modül seviyesi ✓ — mevcut `setChatLogger`/`setStopCheck`
   deseniyle **aynı** ✓) · `targetFor(model)` ✓ → `{ url, model, local }` ✓ · `listLocalModels(base)` ✓
   (`GET {base}/models` ✓ — aynı zamanda **“adres açık mı”** sınaması ✓). **Tüm metin/görsel çağrıları tek kapıdan**
   (`chatOnce` ✓) geçtiği için yönlendirme **tek yerde** ✓.
2. **Hata mesajları sağlayıcı-nötr** oldu ✓ (*“Yerel sunucu 500: …”* ✓) ve **401/402 yalnız OpenRouter için ölümcül** ✓ —
   yerel sunucu 401 dönerse **zincir devam eder** ✓ (yoksa yedekler hiç denenmezdi ✗).
3. **`graph-types.ts`** ✓: `localBaseUrl?: string` ✓ (**isteğe bağlı** ✓, varsayılan `''` ✓).
4. **`main.ts`** ✓: `getSettings()` içinde `setLocalEndpoint(s.localBaseUrl)` ✓ → **tek yerden** uygulanır ✓
   (**boş = her şey OpenRouter** ✓); yeni IPC ✓ `local:models` ✓.
5. **`preload.ts` + `types.ts`** ✓: `listLocalModels` ✓ (isteğe bağlı ✓).
6. **`SidePanel` “Metin Modeli” kutusunda AYRI TUŞ** ✓: **“+ Yerel model”** ✓ → sunucu **hazır listesi** ✓
   (llama.cpp **8080** ✓ · Ollama **11434** ✓ · LM Studio **1234** ✓) + **adres alanı** ✓ + **“Adresi kaydet”** ✓ +
   **“Yerel listeyi getir”** ✓; yerel satırlar **AYNI datalist'e** `local:model` olarak eklenir ✓ (`App.tsx` ✓
   `onLoadLocalModels` ✓) → **aynı anda ikisi de listeden seçilebilir** ✓✓.
7. **Yerel satırlar için “görsel desteklemiyor” uyarısı GÖSTERİLMEZ** ✗ (yerelde vision **bilinmiyor** ✗ →
   **yanlış uyarı vermemek** için ✓).

## Değişmeyen
**Adres boşken davranış birebir aynı** ✓ (tüm istekler OpenRouter ✓) · node/akış JSON şeması ✓ ·
`ModelChain` işlevi ✓ · **kurtarma ajanı kendi ayrı anahtarını kullanmaya devam eder** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst ✗ — en önemli satır)
**Gerçek bir yerel sunucu ile DENENMEDİ** ✗ — bu makinede **llama.cpp/Ollama yok** ✗ → *“yerel yol uçtan uca çalışıyor”*
**iddia edilmiyor** ✗. Senin denemen gereken şeyler ✓: (1) `llama-server -m qwen3.5-9b.gguf --port 8080 --jinja` ✓
(Ollama kullanıyorsan yalnız `ollama serve` ✓ yeter ✓, modeli `ollama pull qwen3.5:9b` ✓ ile çek ✓);
(2) Ayarlar → **Metin Modeli → “+ Yerel model”** → sunucu seç ✓ → **Adresi kaydet** ✓ → **“Yerel listeyi getir”** ✓
(liste gelmezse **adres/sunucu açık değil** ✗); (3) model satırına `local:qwen3.5-9b` ekle ✓ (veya listeden seç ✓),
istediğin sıraya **↑** ile al ✓; (4) bir koşu yap ✓ → **günlükte** isteğin **yerel adrese** gittiğini gör ✓;
(5) **araç çağırma kalitesi** ve **hız** ölçülmedi ✗ — *“iş ilerledi mi”* ölçütüyle sen karar ver ✓.