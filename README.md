# XP Agent Studio

Windows XP görünümünde, **node tabanlı** bir masaüstü otomasyon ajanı. Her node bir aşamadır. Ajan
her aşamada **ekranı okur**: ekran görüntüsünden Windows OCR ile yazıları ve uygulamaların bildirdiği
öğe isimlerini (UI Automation) konumlarıyla toplar. “Opera’ya tıkla” dediğinde ekranda Opera yazan yeri
bulup tıklar; emin olamazsa OpenRouter’daki LLM’e numaralı yazı listesini ve işaretli ekran görüntüsünü
gönderip seçtirir.

## Tıklanacak yer nasıl bulunur?

1. Node yakalamayla oluşturulduysa önce o yakalanan öğe denenir.
2. Prompt’ta tırnak içinde yazı varsa (`“Modeli İndir” yazan yere bas`) ekranda **birebir** aranır, LLM’e gidilmez.
3. API anahtarı varsa LLM, ekrandaki numaralı yazılardan birini seçer (görsel destekli modellerde ekran görüntüsü de gider).
4. Yoksa Türkçe ekleri tanıyan yazı eşleştirmesi yapılır (`operaya`, `Opera’ya` → Opera).
5. Hâlâ bulunamazsa ve node yakalamayla oluşturulduysa, yakalanan konuma tıklanır.

Aynı yazı ekranda birden çok yerdeyse, o node’un son tıklandığı konuma en yakın olanı seçilir.

## Liste döngüsü ve değişkenler

Döngü node’una bir **liste** yazılabilir (her satır bir tur) ya da **“Klasörden doldur…”** ile bir klasördeki
resimler listeye doldurulur (doğal sıralama: `resim2` → `resim10`). Liste doluyken tur sayısı = satır sayısı.

- Döngüyü tekrar eden kısmın **sonuna** koy, “tekrar” çıkışını o kısmın **ilk** node’una bağla. Turlar bitince akış döngü kartından değil, grubun çerçevesindeki **bitti** noktasından devam eder; o noktayı dışarıdaki bir node’a bağla.
- Değişen yerlere yer tutucu yaz; her turda listenin sıradaki satırıyla doldurulur:
  `{{öğe}}` (tam yol), `{{öğe.ad}}` (kedi.png), `{{öğe.isim}}` (kedi), `{{sıra}}`, `{{toplam}}`.
  Tıkla/Yazı Yaz prompt’larında, yazılacak metinde, tuşlarda ve bekleme yazılarında çalışır.
- Döngü kaçıncı öğede olduğunu kaydeder; durdurup tekrar başlatınca kaldığı yerden devam eder (“Baştan başla”
  ile sıfırlanır).
- Döngüye giren node’ların altında yarı saydam bir çerçeve çıkar (Blender’daki frame gibi); başlığından tutup
  sürükleyince tüm grup birlikte taşınır.

Örnek (her resmi yükle, indirilen dosyaya resmin adını ver; tarayıcıda “indirmeden önce nereye kaydedileceğini
sor” açık olmalı):

```
Başlangıç → Tıkla “Resim yükle” → Yazı Yaz {{öğe}} + Enter → Tıkla “Oluştur” → Öğeyi Bekle “İndir”
          → Tıkla “İndir” → Yazı Yaz D:\Modeller\{{öğe.isim}}.glb + Enter → Döngü (tekrar → “Resim yükle”)
grup çerçevesinin “bitti” çıkışı → Bitir
```

## Ekran görüntüsü modu (görsel LLM)

Tıkla, Yazı Yaz, Tuş Gönder, Öğeyi Bekle ve Koşul node’larında **“Ekran görüntüsüne bakarak yap”** seçeneği var.
Açıkken node aynı işi yapar ama hedefi yazı eşleştirmesi yerine **görsel LLM** bulur:

- **Tıkla / Yazı Yaz:** ekran görüntüsü (bulunan yazılar numaralı kutularla işaretli) görsel modele gider. Model bir
  kutu numarası ya da doğrudan bir nokta verir; nokta verirse o bölge yakınlaştırılıp ikinci kez sorulur ve kesin
  noktaya tıklanır. İkon, resim, yazısız butonlar da bulunabilir (“sağ üstteki dişli simgesine tıkla”).
- **Tuş Gönder:** tuşlardan önce tarif edilen yere tıklayıp odaklanır (“adres çubuğu”).
- **Öğeyi Bekle / Koşul:** her kontrolde ekran görüntüsü alınıp “bu durum var mı?” diye sorulur; serbest tarif
  yazılabilir (“indirme çubuğu %100 olmuş”).

Görsel model **Ayarlar > Görsel LLM** kısmından ayrıca seçilir ve kaydedilir; aynı OpenRouter anahtarını kullanır.
Varsayılan `google/gemini-3.8-flash`. “Görsel Test” butonu ekranı çekip modele anlattırır.

## Exe

Repoda hazır portable paket: **`XP-Agent-Studio.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok.

## Node türleri

| Node | Ne yapar | Çıkışlar |
| --- | --- | --- |
| Başlangıç | Akışın giriş noktası | sonra |
| Tıkla | Ekranda yazan yazıyı bulup tıklar (tek/çift/sağ tık) | sonra |
| Yazı Yaz | Bir alana (veya o an seçili alana) metin yazar, isteğe bağlı Enter. Tıklama, silme ve yazma arasında kısa beklemeler vardır; metin harf harf gider | sonra |
| Tuş Gönder | Kısayol/tuş (`{ENTER}`, `^a`, `%{F4}` …) | sonra |
| Zamanlayıcı | N saniye bekler | sonra |
| Öğeyi Bekle | Bir yazı ekranda görünene kadar bekler | bulundu / zaman aşımı |
| Koşul | Ekranda bir yazı var mı? | var / yok |
| Döngü | N kez “tekrar”a döner. “bitti” çıkışı node’da değil, grubun çerçevesindedir | tekrar (node) / bitti (çerçeve) |
| Bitir | Akışı sonlandırır | — |

## Kullanım

- **İleriye ekle:** node’un sağındaki yeşil **+** → tür seç. Arada bağlantı varsa yeni node araya girer.
- **Bağla:** renkli çıkış noktasını sürükleyip başka bir node’un üstüne bırak (ya da noktaya tıkla, sonra hedef node’a tıkla). Ekran kenarına gelince canvas kayar.
- **Tuval:** tekerlek yakınlaştırır/uzaklaştırır, orta tuşla basılı tutup sürüklemek kaydırır. Köşedeki yüzdeye tıklayınca yakınlaştırma 100% olur.
- **Başa dön:** son node’un çıkışını ilk aşamaya bağla. Sayılı tekrar için **Döngü** node’u kullan. Sonsuz döngüye karşı “Maks. adım” koruması var.
- **Sil:** node’u veya bağlantıyı seçip `Del`; bağlantıya çift tıklamak da siler. `Ctrl+D` kopyalar.
- **Sağ tık:** boş yerde node ekleme menüsü; node üzerinde “Buradan çalıştır / Kopyala / Bağla / Sil”.
- **Ekran Tarayıcı:** uygulama küçülür, ekranın görüntüsü alınır; bulunan her yazı kutuyla işaretlenir. Bir kutuya tıkla → seçili node’a (yoksa yeni “Tıkla” node’una) o yazı atanır. Arama kutusuyla filtreleyebilirsin.
- **İmleçle Yakala (3 sn):** 3 saniye içinde imleci hedefe götür; o yer node’a bağlanır.
- **Tıklama türü:** tek tık, çift tık (masaüstü simgeleri) veya sağ tık.
- Çalışırken uygulama kendini küçültür, bitince geri gelir. **Ctrl+Shift+Q** ile durdurursun.
- **Dışa/İçe Aktar:** akışı JSON olarak kaydet/aç. Akış ve ayarlar ayrıca otomatik kaydedilir.

## İlk kurulum

1. Ayarlar → OpenRouter API Key → **Kaydet**, sonra **API Test**
2. Model adı (listeden seçmek için “Model listesini getir”) → **Kaydet**
3. Hedef pencere → **Kaydet** (boş bırakılırsa tüm ekran okunur)
4. Node’ları diz, **▶ Ajanı Çalıştır**

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite (hot reload)
npm run dev:web      # Sadece arayüz, tarayıcıda http://127.0.0.1:4521 (tıklamalar simüle)
npm run pack:win     # release/XP-Agent-Studio.exe üretir
```

Ekran okuma ve tıklama, `a11y/` altındaki PowerShell script’leriyle yapılır (`worker.ps1` sürekli açık kalan
tek bir süreç; `screen.ps1` ekran görüntüsü + `Windows.Media.Ocr` + UI Automation).
Bu yüzden gerçek otomasyon yalnızca Windows 10/11’de çalışır. Linux/macOS’ta demo ekran ve simüle tıklamalar
kullanılır. OCR, Windows’ta yüklü dil paketlerini kullanır (Türkçe/İngilizce çoğu kurulumda hazırdır).
API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır.
