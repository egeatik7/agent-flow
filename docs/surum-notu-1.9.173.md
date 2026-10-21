# Sürüm notu — 1.9.173 (Koşul: güvene göre bağımsız ikinci görüş)

**Taban:** `6522720` (1.9.172) · Kaynak paket:
`C:\Users\ASUS TUF\Downloads\Nubbo-Kosul-Guven-Ikinci-Gorus-172`
(`CURSOR-DEEPSEEK-OKU.md`, `DOGRULAMA.md`, `PATCH-KONTROLU.json`, `SHA256.json`,
`01-onceki-patch-uzerine.patch`, `02-temiz-1.9.172-tam.patch`, `test-logs/`)

## Paket doğrulaması

- İki patch dosyasının SHA-256'sı `SHA256.json` ile **birebir eşleşti**
  (`a8d2bbeb…`, `11692140…`).
- **Doğru patch seçildi:** `01-onceki-patch-uzerine.patch` bu tabana **uygulanmıyor**
  (`git apply --check` → `patch does not apply`; `--reverse --check` da başarısız, yani önceki
  kanıtlı karar düzeltmesi bu ağaçta yok). Temiz 1.9.172 tabanına uyan tek dosya
  `02-temiz-1.9.172-tam.patch` oldu (`git apply --check` → 0); önceki düzeltmeyi de içeriyor.
  Zorlama, `--reject`, `reset --hard` veya `checkout -- .` kullanılmadı.
- Uygulama sonrası `git diff --check` **temiz** (0 çıktı).
- Beş dosyanın içeriği `PATCH-KONTROLU.json` ile **birebir eşleşti** (satır sonu normalleştirilerek
  SHA-256): `electron/agent.ts` `9a866799…`, `electron/openrouter.ts` `af43993e…`,
  `tests/condition-decision.test.ts` `fecc4c59…`, `tests/condition-target.test.ts` `543523a9…`,
  `tests/fix-tur6-condition-model.test.ts` `dad0a934…`. Ham bayt farkı yalnız repoda yerleşik
  **CRLF** satır sonudur (`core.autocrlf=true`; komşu dosyalar da CRLF); içerik aynı.

## Bu sürümdeki davranış (Koşul kararı)

1. **Kanıt sözleşmesi önce denetlenir.** Geçerli JSON, güncel aday ID'si ve adayla tutarlı metin
   (veya gerekçeli `basis:absence`) geçmeden hiçbir cevap karar üretmez; yüksek puan bu denetimleri
   aşamaz. Sayısal sayaç karşılaştırması alt dize eşleşmesiyle yapılmaz (`0` / `2`, `20` sayılmaz).
2. **Güven eşiği** (`confidence` 0..1; `0.75` = %75; sayısal `75` normalize edilir, `1` = %100;
   negatif, 100'den büyük, `null` veya metin **bozuk çıktı** sayılır):
   - **≥ %75** → hemen ilgili kola (tek çağrı; ikinci model/OCR zorunlu değil). `satisfied:false`
     da %90 gibi yüksek güvenle verilebilir.
   - **%50–%75** → koşul zincirindeki **sıradaki modele aynı güncel gözlem bağımsız** sorulur.
   - **< %50** → aynı gözlemde oylama tekrarlanmadan sonraki okuyucuya geçilir.
   - **`basis:unknown`** → önceki davranış gibi sonraki okuyucuya geçilir.
3. **İkinci görüş bağımsızdır.** İlk cevabın sonucu, puanı veya gerekçesi ikinci modele
   gönderilmez; iki modele de aynı system/user gözlemi gider. İkinci görüş ancak **aynı cevabı
   ≥ %75 güvenle** verirse kabul edilir. Zıt cevap, düşük güven, puansız ikinci cevap veya
   unknown o gözlemde karar üretmez; **üçüncü bir geçerli görüş aranmaz**.
4. **Teknik hata görüş sayılmaz.** İlk yedek HTTP 503 verirse sonraki yedek ikinci geçerli görüşü
   sağlayabilir; bağlantı hatası yanlış bir "hayır" cevabına çevrilmez (ikinci görüş tamamlanamazsa
   sıradaki okuyucuya geçilir). Gerçek bozuk çıktı için mevcut tek düzeltme denemesi korunur.
5. **Şüphecilik bekleme döngüsü üretmez.** Her okuyucuda en çok iki geçerli görüş alınır; iki %60
   cevap ortalanıp zorla %75 yapılmaz. UIA ve OCR de güven nedeniyle karar veremezse aynı oylama
   dört taze turla çarpılmadan **mevcut salt okunur Koşul Kurtarmasına** devredilir
   (`ConditionConfidenceExhaustedError` → `repeatMethodCycle` `terminal`). Kurtarma kapalıysa veya
   güvenle karar veremezse mevcut açık hata/devir davranışı korunur.
6. **Geriye uyumluluk.** `confidence` alanı tamamen eksikse ilk geçerli kanıtlı cevap önceki
   sözleşmeyle kabul edilir; ona sahte bir %100 atanmaz (günlükte `eski-sozlesme`). Ancak ilk model
   puan verip ikinci görüş gerektirdiyse puansız yedek cevap %75 onay yerine geçmez. Güncel isteğe
   sabit JSON sözleşmesi eklendiği için kaydedilmiş özel promptlarda da yeni alan istenir.
7. **Günlük.** `KOSUL-GUVEN model=… karar=… guven=… islem=…`; işlemler `kabul`, `ikinci-gorus`,
   `ikinci-gorus-onay`, `sonraki-yontem`, `eski-sozlesme`. Eşik altındaki puan yukarı yuvarlanıp
   %75 gösterilmez (%60 → `60`). Başarılı ikinci görüş, mevcut `CEVAPLAYAN` kaydında **gerçekten
   cevaplayan modelle** görünür. Koşul yolu hâlâ fare/tuş/yazı girdisi göndermez; `Stop` ve gözlem
   iptali her iki model cevabını da geçersiz kılabilir.

## Kod kapsamı

- `electron/openrouter.ts` — `ConditionEvidenceUnknownError` / `ConditionConfidenceUnknownError` /
  `ConditionSecondOpinionError`, `conditionConfidence()` normalizasyonu, `conditionTextAgrees()`
  sayısal karşılaştırma, `validateConfidence()` akışı, prompt'a `confidence` alanı, `ScreenChoice`
  tipine `basis`.
- `electron/agent.ts` — `satisfied:false` + (kanıt ID veya `basis:absence`) durumu **karar** olarak
  kabul edilir; güven tükenmesi Kurtarmaya devredilir (`terminal`).
- `tests/condition-decision.test.ts` — **50 test** (önceki 15 + yeni 35); `tests/condition-target.test.ts`
  ve `tests/fix-tur6-condition-model.test.ts` uyarlaması.
- **Değişmeyenler:** node/ayar şeması, model sırası, tuval/paket JSON'ları, pencere odağı, bekleme
  süreleri, bağımlılıklar, sürüm numarası dışında yapılandırma.

## Doğrulama (bu makinede, Windows)

- `npm run typecheck` ✓ (üç proje).
- Paketin istediği **sekiz dosya: 136/136 geçti** (`condition-decision` 50 dâhil).
- `npx vitest run` → **202 dosya / 1583 test yeşil** (1.9.172'de 201/1533; +1 dosya, +50 test).
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 — **0 kırmızı**.
- Yedi PowerShell **5.1** harness'ı `exit=0`: `test-worker`, `test-keyboard-safety`,
  `test-visual-input`, `test-screen`, `test-scan-frame`, `test-visual-crop-geometry`,
  `test-screen-opaque`. (`test-screen` çıktısındaki "başarısız görüntü aramasında 20 bitmap'in 15'i
  açık kalıyor" **PARTIAL** notu bu patch'ten önce de vardı: `a11y/screen.ps1` değişmedi.)
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Gerçek model / Windows / Chrome / Ollama / Hunyuan kabulü yapılmadı.** Paketin yedi Windows kabul
  maddesi (yüksek güven tek çağrı, %60→%80 ikinci görüş, zıt cevap → OCR → Kurtarma, teknik hata,
  Stop/iptal, Kurtarma açık/kapalı, eski puansız cevap / uydurma ID) yalnız otomatik testlerle
  sınandı; gerçek model kalibrasyonu ölçülmedi.
- `confidence` **modelin kendi beyanıdır**, ölçülmüş doğruluk olasılığı değildir; iki modelin
  anlaşması da hatasızlık garantisi vermez. Doğal dil gerekçesi ile boolean arasındaki bütün
  çelişkiler kodla çözümlenmez (kanıt/metin denetimleri korunur).
- Paketin kendi Linux ortamındaki tam taraması **kırmızıydı** (14 hata + 1 dosya yükleme hatası,
  Chrome/Electron ikilisi ve zaman aşımı kaynaklı). Bu makinede tam tarama **yeşil**; bu, Windows
  davranışının canlı kanıtı değildir.

## EXE

`Nubbo-1.9.173.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.173.exe` · SHA256
`76C05FC2EB4542001668E7246E373081E78BD593A7145CFB5EF0F04C4C75C1C1` (build = masaüstü kopyası,
97.591.295 bayt). Build damgası `resources/build.json` içinde `15eb31e`, `dirty=false`,
`version=1.9.173` — etiketli commit ile aynı ağaçtan üretildi. Masaüstündeki eski `Nubbo-*.exe`
dosyaları silinmedi.
