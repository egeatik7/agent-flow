# Sürüm notu — 1.9.147

**Taban:** `46ff1ed` (1.9.146). `nubbo-zamanlama-01.patch`. Kurtarma devrinin yerine geçmez.

## Ne değişti

- Koşu sırasında kaydedilen model, anahtar ve yöntem ayarı sonraki çağrıda okunur. Gönderilmiş çağrı değişmez.
- Başarılı kayıt yerel sunucu ayarını hemen uygular. Süren model zinciri kendi sunucusunu tutar; yeni tur yeni sunucuyla başlar.
- Model adı Enter veya alandan çıkınca kaydolur. Sıralama ve hazır model seçimi hemen uygulanır.
- Aynı adrese giden eski model listesi cevabı yeni listeyi ezmez.
- Paket içinden devam, kayıtlı dış döngü öğesini ilk girdiden önce doğrular. Öğe yoksa veya birden fazlaysa girdi gitmez.
