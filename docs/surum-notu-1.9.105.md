# Sürüm notu — 1.9.105 ("Metin modeline numaralı ekran görüntüsü gönder" ayarı gerçekten çalışıyor)

**Kaynak**: kullanıcının sorusu — *"şu an metin modeline numaralı ekran görüntüsü gönder çalışıyor mu kontrol et."*

## Cevap: ÇALIŞMIYORDU (ölü ayardı) — artık çalışıyor

**Ölçülen kök neden (koddan, satır satır):**
1. `electron/agent.ts` içindeki `windowsScan()` (hedef bulma taraması) çağrıyı **sabit `false`** ile yapıyordu:
   `scanFor(false, …)` → köprüye `image:'none'` gidiyordu. Yani ekran görüntüsü **hiç alınmıyordu**.
2. Hemen ardından aynı blok görüntüyü **açıkça siliyordu** (`winScan = { ...winScan, image: null }`).
3. `pickFrom` ise görüntüyü şu koşulla gönderiyor: `sendImage: … && s.sendScreenshot && !!scan.image`.
   `scan.image` her zaman boş olduğu için **`sendImage` daima `false`**'tı.
4. Sonuç: kutu işaretli olsa da modele **hiçbir zaman** resim gitmiyordu; hedef seçimi yalnız numaralı
   **yazı listesinden** yapılıyordu. Numaraları çizen worker kodu (`a11y/screen.ps1:700-704`, `$mode -eq 'marked'`)
   yerinde duruyordu ama hiç **istenmiyordu**.

## Düzeltme (`electron/agent.ts`, `resolveTarget` → `windowsScan`)

- Tarama artık ayarı **gerçekten** okuyor:
  `wantImage = s.sendScreenshot && !ocrOnly && !!prompt && (!!s.apiKey.trim() || localConfigured())`.
- Ayar açıkken tarama **`image:'marked'`** istiyor → worker dikdörtgenleri ve **öğe numaralarını** çiziyor →
  `chooseScreenTarget` bu görüntüyü isteğe `image_url` olarak ekliyor.
- Görüntü, karar yolunda **korunuyor** (`image: wantImage ? winScan.image : null`); tanılama amaçlı
  çekimler yine kendiliğinden model girdisi olmuyor.
- **Görüntü yalnız gerçekten metin modeline sorulacaksa** isteniyor: **Koşul** node'unda (kanıt kuralı gereği
  resim kullanılamaz), metinsiz düğümde ve **model yokken** (ne API anahtarı ne yerel adres) istenmiyor —
  yani boşuna ekran görüntüsü alınmıyor.
- Yerel model görüntüyü kabul etmezse mevcut davranış korunuyor: `ImageUnsupportedError` → uyarı +
  **yazı listesiyle** devam (akış durmuyor).

## Doğrulama

- Yeni `tests/fix-tur8-screenshot.test.ts` **5/5** ✓ — gerçek ajan yolu (sahte köprü + sahte `fetch`) ile:
  ayar **açık**ken taramanın `marked` istediği ve isteğe **`MARKED_BYTES`** görüntüsünün eklendiği;
  ayar **kapalı**yken ne `marked` istendiği ne görüntü gönderildiği; **Koşul**'da ayar açık olsa bile
  görüntü istenmediği/gönderilmediği; **model yokken** hiç `marked` istenmediği ve hiç model isteği
  yapılmadığı; **Yazı Yaz** yolunun da aynı ayarı kullandığı. (Test, düzeltme öncesi kodda düşer:
  ilk iddia `scan.image === 'marked'` idi ve eski kod `'none'` istiyordu.)
- `typecheck` ✓ (üç proje) · **Vitest 120 dosya / 953 geçti / 1 atlandı / 0 kırmızı** ✓ (taban 119/948).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.

## Bilmen gereken maliyet (dürüst uyarı)

- Ayarın **varsayılanı açık** (`DEFAULT_SETTINGS.sendScreenshot: true`). Bu düzeltmeden sonra ayar
  **gerçekten** çalıştığı için, modelle hedef arayan her **Tıkla/Yazı Yaz** adımında artık bir **numaralı
  ekran görüntüsü** alınır ve modele gönderilir: **daha fazla token ve birkaç yüz ms gecikme** demektir
  (uzun döngülerde toplanır). İstemiyorsan **Ayarlar → Genel → "Metin modeline numaralı ekran görüntüsü
  gönder"** kutusunu **kaldır**; kutu kapalıyken hiç görüntü alınmaz ve karar yalnız yazı listesinden verilir.
- Numaralar görüntüde **öğe kimlikleri** olarak çizilir; OCR kelime satırları listede `parent=#id` ile bu
  kimliğe bağlanır (mevcut tasarım). Görüntü kabul etmeyen bir yerel model seçiliyse sistem yazı listesine
  düşer ve bunu günlüğe yazar.
- **Canlı masaüstünde** gerçek bir koşuyla gözle denenmedi (testler sahte köprü + `fetch` düzeyinde);
  gerçek bir Tıkla adımında günlükte ekran taramasının görüntüyle yapıldığını görmen doğrulama olur.
