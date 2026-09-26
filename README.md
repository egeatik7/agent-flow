# XP Agent Studio

Windows XP görünümünde **node tabanlı** accessibility-tree ajanı.

## Exe

Repoda hazır portable paket: **`XP-Agent-Studio.exe`** (Windows x64).

Çift tıkla çalıştır — kurulum gerekmez.

## Ne yapar?

1. Her **node** bir aşama prompt’u tutar  
   (örn. `Tepeye "Hunyuan Tencent" yazısına bas`)
2. **Kayıt / İmleçteki Öğeyi Yakala** → imleç altındaki UI Automation öğesini bulur, prompt + path yazar
3. **Ajanı Çalıştır** → her aşamada accessibility tree çeker, OpenRouter ile öğeyi seçer (veya kayıtlı path’i kullanır), tıklar

## İlk kurulum (exe içinde)

1. Ayarlar → OpenRouter API Key → **Kaydet**
2. Model adı → **Kaydet** (varsayılan: `openai/gpt-4o-mini`)
3. Hedef pencere seç → **Kaydet**
4. Node ekle veya Kayıt ile yakala → portlardan sıraya bağla
5. **Ajanı Çalıştır**

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite
npm run dev:web      # Sadece arayüz önizleme
npm run pack:win     # Yeniden exe üret
```

## Notlar

- Gerçek UI Automation yalnızca **Windows**’ta çalışır (PowerShell + UIAutomation).
- Linux/mac önizlemede demo ağaç kullanılır.
- API key `electron-store` ile kullanıcı profiline yazılır.
