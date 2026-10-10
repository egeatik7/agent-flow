# Sürüm notu — 1.9.80 (yerel model “Gelişmiş”: zaman aşımı · görsel beyanı · **“Şimdilik OpenRouter'a dön”**)

Kullanıcının onayı ✓: *“1.9.80 çıkar”* ✓. Planlanan **üç madde** uygulandı ✓.

## Gelen
1. **Zaman aşımı** ✓ — `localTimeoutMs` ✓ (**varsayılan 180 sn** ✓, 10–900 sn arası sınırlı ✓): **yerel** çağrılar bu süreyi
   kullanır ✓; **OpenRouter yolu 90 sn'de kalır** ✗ (davranış değişmedi ✓).
2. **Görsel beyanı** ✓ — `localVision` ✓: yerel sunucu **vision bilgisi vermiyor** ✗ (llama.cpp/Ollama `/v1/models`
   yalnız `id` döndürüyor ✓) → kullanıcı **beyan eder** ✓; beyan edilirse yerel satırlar model listesinde
   **görsel destekli** görünür ✓ ve **görsel modda** kullanılabilir ✓.
3. **“Şimdilik OpenRouter'a dön”** ✓ — `localOff` ✓: açıkken **yerel satırlar atlanır** ✓ ama **adres saklı kalır** ✓
   (silinmez ✓). Atlama `ModelFailed` ile yapılır ✓ → yani **zincir sıradaki modele geçer** ✓ (**hata değil, atlama** ✓).
4. **Ek düzeltme** ✓: **adres boşken** de `local:` satırları **aynı şekilde atlanır** ✓ — eskiden `local:qwen…`
   **literal model adı** olarak OpenRouter'a gidip **boşuna hata** üretirdi ✗.

## Dosyalar
`electron/graph-types.ts` ✓ (üç **isteğe bağlı** alan + varsayılanlar ✓) · `electron/openrouter.ts` ✓
(`setLocalEndpoint` dört parametreye genişledi ✓ · `targetFor` atlama davranışı ✓ · `chatOnce` yerel için
`localTimeoutMs` ✓) · `electron/main.ts` ✓ (`getSettings` dört değeri birlikte uygular ✓) ·
`src/components/SidePanel.tsx` ✓ (**Yerel ayarları kaydet** ✓, görsel beyanı ve OpenRouter'a dön **onay kutuları** ✓,
zaman aşımı alanı ✓) · `src/App.tsx` ✓ (yerel liste **görsel beyanını** dikkate alır ✓).

## Değişmeyen
**Adres boş + `localOff` kapalı iken davranış birebir aynı** ✓ (tüm istekler OpenRouter ✓, 90 sn ✓) ·
node/akış JSON şeması ✓ · `ModelChain` işlevi ✓ · kurtarma ajanı **kendi anahtarı ve kendi zinciri** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan — **kullanıcı denememeyi seçti, kayda geçiyor** ✗
**Gerçek yerel sunucu ile DENENMEDİ** ✗; **“kullanıcı denedi” DENMİYOR** ✗. Yerel modelin **araç çağırma kalitesi**
ve **hızı** ölçülmedi ✗. Ayrıca **1.9.75 / 1.9.76 / 1.9.77 / 1.9.79** da hâlâ **canlı Windows denemesi** bekliyor ✗
(sırasıyla: pakete çift tık & sağ tıkla çıkış ✓; sağ tık menüsü kaldırıldı & Shift+A ✓; döngü öğesinde Yolu aç/çift tık ✓;
yerel model ✓). **Yeşil geçit teslim ölçütü değildir** ✓ — ölçüt gerçek koşuda **işin ilerlemesi**dir ✓.