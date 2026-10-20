# Sürüm notu — 1.9.171 (Paket 1: kanıt sözleşmesi, offset, kurtarma bütçesi, görüntü oturumu, ham Koşul hatası)

**Taban:** `27e531f` (1.9.170) · Kaynak paket:
`C:\Users\ASUS TUF\Downloads\Nubbo-Program-Duzeltme-Paket1-170`
(`DEEPSEEK-OKU.md`, `TEST-SONUCLARI.md`, `nubbo-program-paket1.patch`, `SHA256.json`)

## Paket doğrulaması ve değerlendirme

- Üç dosyanın SHA-256'sı `SHA256.json` ile **birebir eşleşti**
  (`9e1fd8c4…`, `ee3cc886…`, `23db3416…`).
- Patch temiz tabana (`27e531f`, ağaç temiz) `git apply --check` ile **sorunsuz uygulandı**;
  12 dosya, +294/−47 (yeni test dâhil).
- **Değerlendirme: mantıklı ve hedefli bulundu.** Beş sorun da bu oturumda görülen gerçek
  davranışlarla örtüşüyor; şema/tuval/ayar değişikliği yok, eylem öncesi yeni kapı yok,
  `Stop` ve mevcut yöntem sırası korunuyor. Dikkat edilen üç nokta aşağıdaki "Sınırlar"da.

## Bu sürümdeki beş düzeltme

1. **Kanıtsız olumlu Koşul cevabı kabul edilmiyor** (`electron/openrouter.ts`).
   `satisfied:true, id:null` artık yalnız `basis:"absence"` + boş olmayan gerekçeyle geçerli;
   `basis:"unknown"` olumlu/olumsuz sayılmıyor (`MODEL_CONDITION_UNDECIDED`). Kanıt numaralı
   olumlu cevaplar ve `satisfied:false` uyumlu kaldı. Prompt sonuna açık sözleşme eklendi;
   "uygulama bağlamı kurulamazsa false tahmin et" yerine `basis:unknown` istendi.
2. **Eski koordinata düşme bitti** (`electron/agent.ts`). Aynı arama turunda görsel seçici veya
   liste modeli hedefin **bulunmadığını** açıkça bildirdiyse, metinle tanımlı hedefte `offset`
   yöntemi atlanıyor; kalan açık yöntemler sıralarında deneniyor. Yalnız koordinatla tanımlı
   node'lar ve görsel fare taşıma zinciri korunuyor.
3. **Kurtarma uzun bekleyişi tek çağrıda** (`electron/recovery.ts`, `recovery-runtime.ts`,
   `openrouter.ts`). `act_wait` üst sınırı Kurtarma'da **60 sn** (Yap'ta 10 sn kaldı); motor
   beklemeyi kalan bütçeye göre kısaltıyor (karar için en az 1 sn pay), bütçe yenilenmiyor.
   Model her turda kalan süreyi/araç sayısını görüyor; süreler **monoton saat** (`performance.now`)
   ile ölçülüyor, rapor tarihleri duvar saati kalıyor ve `elapsedMs` eklendi. Stop uzun beklemeyi
   kesiyor.
4. **Görüntü kabul etmeyen model aynı Kurtarma oturumunda yeniden zorlanmıyor**
   (`electron/openrouter.ts`). Sağlayıcının açık "image input desteklenmiyor" yanıtı model+uç
   noktası için yalnız o oturumda işaretleniyor; sonraki görüntülü tur doğrudan yedek modeli
   deniyor. Metin turlarında model yine kullanılabiliyor. Yeni oturum/anahtar/model sırası/revizyon
   değişimi işareti sıfırlıyor. Genel 404/429/geçici hatalar kalıcı sayılmıyor; oturum nesnesi
   sağlayıcıya, rapora veya ayara yazılmıyor.
5. **Ham Koşul gözlem hatası Kurtarma'yı atlamıyor** (`electron/runner.ts`). `exists` dışına çıkan
   teknik hata (fatal/Stop/permanent hariç) "hayır" sayılmıyor; aynı node, render edilmiş hedef,
   döngü değişkenleri ve **kök tuval** ile salt-okunur Kurtarma'ya devrediliyor. Kurtarma `var`
   derse evet, kanıtlı `yok` derse (bağlıysa) hayır kolu çalışıyor; kapalıysa hata mesajı gözlem
   hatasını da içeriyor. Koşul'a üçüncü çıkış eklenmedi; 3 turluk ek dış tekrar kaldırıldı (okuyucu
   zaten kendi içinde 4 tura kadar deniyor).

## Doğrulama (bu makinede, Windows)

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **199 dosya / 1517 test** yeşil (paketle 24 yeni test geldi).
- Paketin istediği 9 dosya: **121/121** geçti.
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 — **0 kırmızı**.
- PowerShell: `test-worker`, `test-keyboard-safety`, `test-visual-input`, `test-screen`,
  `test-scan-frame`, `test-visual-crop-geometry`, `test-screen-opaque` — **hepsi geçti**.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Canlı Windows/Ollama/Hunyuan/masaüstü tıklaması yapılmadı.** Paketin altı kabul senaryosu
  (kanıtsız olumlu cevap, gerçek yokluk, offset, 60 sn bekleme + Stop, görüntü reddi/yedek model,
  paket+döngü içi okuyucu hatası) yalnız otomatik testlerle sınandı; gerçek ekran kaydı yok.
- Kanıt sözleşmesi **yapısaldır**: model geçerli bir numara seçip kanıtı yanlış yorumlarsa veya
  yanlış `basis:"absence"` yazarsa bu çözülmez.
- Offset atlama, modelin "hedef yok" bildirimine güvenir; model yanlışlıkla yok derse kayıtlı
  konum o turda kullanılmaz (kalan yöntemler/Kurtarma devreye girer).
- Kurtarma **kapalıysa**, geçici bir okuyucu hatası artık 3 kez yeniden denenmek yerine açık
  gerekçeyle durur (paketin bilinçli tercihi; kullanıcı Kurtarma'yı açarsa devir çalışır).
- 180 sn'lik bütçenin sonunda başlayan 181 sn'lik üretim tamamlanmaz; bütçe dolması "model
  bilinçli vazgeçti" değil, teknik sınır olarak raporlanır.
- Paketin Linux ortamındaki tam taraması yeşil değildi (ortam kaynaklı 14 hata + 1 yükleme hatası);
  bu makinede tam tarama yeşil. Bu, Windows davranışının canlı kanıtı değildir.

## Sonraki paket (değişmedi)

GLB/indir hedeflerinin iş bağlamı, Kurtarma'ya tüm tuval/geçmiş gönderme maliyeti, başlat/devam/
checkpoint seçiminin açık kaydı, checkpoint izleyici/saklama ve FolderBatcher raporu — paket 2'de.

## EXE

`Nubbo-1.9.171.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.171.exe` · SHA256
`61BF002A04E728159B03B1C1BA486EF6A7815977941947239057A5686A354315` (build = masaüstü kopyası,
97.585.194 bayt).
