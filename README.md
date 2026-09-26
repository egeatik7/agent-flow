# XP Agent Studio

Windows XP görünümünde, **node tabanlı** accessibility-tree ajanı. Her node bir aşama prompt’u tutar; ajan OpenRouter LLM ile UI Automation ağacından tıklanacak öğeyi seçer (veya kayıtlı path kullanır).

## Özellikler

- XP Luna arayüzü (başlık çubuğu, taskbar, klasik butonlar)
- OpenRouter API key + model adı (yanlarında **Kaydet**)
- Hedef pencere, ağaç derinliği, aşama gecikmesi — kayıt tuşlarıyla
- Sürüklenebilir node canvas, port ile bağlantı
- **Kayıt** / **İmleçteki Öğeyi Yakala** → a11y öğesini prompt + path olarak node’a yazar
- Accessibility tree paneli → öğeye tıklayınca seçili node’a bağlar
- Ajan koşusu: her aşamada tree çek → LLM seç → tıkla

## Windows’ta çalıştırma

Hazır paket: `release/XP-Agent-Studio.exe` (portable).

1. Exe’yi çalıştır
2. Ayarlar → API key ve model → **Kaydet**
3. Hedef pencereyi seç → **Kaydet**
4. Node ekle veya Kayıt ile yakala
5. **Ajanı Çalıştır**

## Geliştirme

```bash
npm install
npm run dev
```

Windows exe üretmek için (Windows makinede veya wine ile):

```bash
npm run pack:win
```

## Notlar

- Accessibility otomasyonu yalnızca **Windows** üzerinde gerçek UI Automation kullanır.
- Linux/macOS’ta demo tree ile arayüz test edilir; tıklama no-op’tur.
- API key `electron-store` ile kullanıcı dizinine kaydedilir.
