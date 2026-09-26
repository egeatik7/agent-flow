# XP Agent Studio

Windows XP görünümünde, **node tabanlı** bir masaüstü otomasyon ajanı. Her node bir aşamadır. Ajan
her aşamada **ekranı okur**: ekran görüntüsünden Windows OCR ile yazıları ve uygulamaların bildirdiği
öğe isimlerini (UI Automation) konumlarıyla toplar. “Opera’ya tıkla” dediğinde ekranda Opera yazan yeri
bulup tıklar; emin olamazsa OpenRouter’daki LLM’e numaralı yazı listesini ve işaretli ekran görüntüsünü
gönderip seçtirir.

## Tıklanacak yer nasıl bulunur?

1. Node kayıtla/yakalamayla oluşturulduysa önce o kayıtlı öğe denenir.
2. Prompt’ta tırnak içinde yazı varsa (`“Modeli İndir” yazan yere bas`) ekranda **birebir** aranır, LLM’e gidilmez.
3. API anahtarı varsa LLM, ekrandaki numaralı yazılardan birini seçer (görsel destekli modellerde ekran görüntüsü de gider).
4. Yoksa Türkçe ekleri tanıyan yazı eşleştirmesi yapılır (`operaya`, `Opera’ya` → Opera).
5. Hâlâ bulunamazsa ve node kayıtla oluşturulduysa, kayıttaki konuma tıklanır.

Aynı yazı ekranda birden çok yerdeyse, o node’un son tıklandığı konuma en yakın olanı seçilir.

## Exe

Repoda hazır portable paket: **`XP-Agent-Studio.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok.

## Node türleri

| Node | Ne yapar | Çıkışlar |
| --- | --- | --- |
| Başlangıç | Akışın giriş noktası | sonra |
| Tıkla | Ekranda yazan yazıyı bulup tıklar (tek/çift/sağ tık) | sonra |
| Yazı Yaz | Bir alana (veya o an seçili alana) metin yazar, isteğe bağlı Enter | sonra |
| Tuş Gönder | Kısayol/tuş (`{ENTER}`, `^a`, `%{F4}` …) | sonra |
| Zamanlayıcı | N saniye bekler | sonra |
| Öğeyi Bekle | Bir yazı ekranda görünene kadar bekler | bulundu / zaman aşımı |
| Koşul | Ekranda bir yazı var mı? | var / yok |
| Döngü | N kez “tekrar”a, sonra “bitti”ye gider | tekrar / bitti |
| Bitir | Akışı sonlandırır | — |

## Kullanım

- **İleriye ekle:** node’un sağındaki yeşil **+** → tür seç. Arada bağlantı varsa yeni node araya girer.
- **Bağla:** renkli çıkış noktasını sürükleyip başka bir node’un üstüne bırak (ya da noktaya tıkla, sonra hedef node’a tıkla). Ekran kenarına gelince canvas kayar.
- **Başa dön:** son node’un çıkışını ilk aşamaya bağla. Sayılı tekrar için **Döngü** node’u kullan. Sonsuz döngüye karşı “Maks. adım” koruması var.
- **Sil:** node’u veya bağlantıyı seçip `Del`; bağlantıya çift tıklamak da siler. `Ctrl+D` kopyalar.
- **Sağ tık:** boş yerde node ekleme menüsü; node üzerinde “Buradan çalıştır / Kopyala / Bağla / Sil”.
- **Ekran Tarayıcı:** uygulama küçülür, ekranın görüntüsü alınır; bulunan her yazı kutuyla işaretlenir. Bir kutuya tıkla → seçili node’a (yoksa yeni “Tıkla” node’una) o yazı atanır. Arama kutusuyla filtreleyebilirsin.
- **Kayıt:** açıkken başka bir uygulamada tıkladığın her yer, tıklanan yazıyla birlikte sıradaki “Tıkla” node’u olarak eklenir.
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
tek bir süreç; `screen.ps1` ekran görüntüsü + `Windows.Media.Ocr` + UI Automation; `record.ps1` tıklama kaydı).
Bu yüzden gerçek otomasyon yalnızca Windows 10/11’de çalışır. Linux/macOS’ta demo ekran ve simüle tıklamalar
kullanılır. OCR, Windows’ta yüklü dil paketlerini kullanır (Türkçe/İngilizce çoğu kurulumda hazırdır).
API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır.
