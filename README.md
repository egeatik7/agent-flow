# XP Agent Studio

Windows XP görünümünde, **node tabanlı** bir masaüstü otomasyon ajanı. Her node bir aşamadır; ajan
her aşamada hedef uygulamanın **accessibility tree**’sini okur, OpenRouter’daki LLM ile doğru öğeyi
seçer ve tıklar / yazar / tuş gönderir.

## Exe

Repoda hazır portable paket: **`XP-Agent-Studio.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok.

## Node türleri

| Node | Ne yapar | Çıkışlar |
| --- | --- | --- |
| Başlangıç | Akışın giriş noktası | sonra |
| Tıkla | Prompt’a (veya kayıtlı öğeye) göre öğeye tıklar | sonra |
| Yazı Yaz | Bir alana metin yazar, isteğe bağlı Enter | sonra |
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
- **Kayıt:** açıkken hedef uygulamada tıkladığın her öğe accessibility tree’den bulunur ve sıradaki “Tıkla” node’u olarak eklenir (prompt + öğe yolu yazılır).
- **Öğe Yakala (3 sn):** 3 saniye içinde imleci hedef öğeye götür; öğe node’a bağlanır.
- **Dışa/İçe Aktar:** akışı JSON olarak kaydet/aç. Akış ve ayarlar ayrıca otomatik kaydedilir.

## İlk kurulum

1. Ayarlar → OpenRouter API Key → **Kaydet**, sonra **API Test**
2. Model adı (listeden seçmek için “Model listesini getir”) → **Kaydet**
3. Hedef pencere → **Kaydet** (boş bırakılırsa kayıtlı öğenin penceresi kullanılır)
4. Node’ları diz, **▶ Ajanı Çalıştır**

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite (hot reload)
npm run dev:web      # Sadece arayüz, tarayıcıda http://127.0.0.1:4521 (tıklamalar simüle)
npm run pack:win     # release/XP-Agent-Studio.exe üretir
```

UI Automation, `a11y/` altındaki PowerShell script’leriyle (`System.Windows.Automation`) yapılır; bu yüzden
gerçek otomasyon yalnızca Windows’ta çalışır. Linux/macOS’ta demo ağaç ve simüle tıklamalar kullanılır.
API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır.
