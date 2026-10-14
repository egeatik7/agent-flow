# Sürüm notu — 1.9.137

**Taban:** `1849192` (1.9.135). Kaynak: `nubbo-tum-ayarlar-otomatik-kayit.patch`.

Yerel 1.9.136 kaydı geri alındı. Bu paket görsel model devamını ve ayarların otomatik kaydını birlikte getirir.

## Ne değişti

- Genel, yerel, prompt ve kurtarma ayarları Kaydet'e basmadan kalıcı kayda yazılır.
- Model sırası, seçim ve onay kutuları da otomatik kaydolur. Yarım sayı veya bitmemiş metin geçerli kaydı silmez.
- Katalog, test, sohbet ve çalıştırma bekleyen kayıt bitmeden eski ayarla başlamaz.
- Kapanış son ayar yazmasını bekler. Disk hatasında kapanış reddedilir.
- Görsel hedef, kayıtlı sırası değişmediyse kabul edilen modelin zinciriyle devam eder. Sıra değişince sonraki yeni çağrı yeni sırayı kullanır.
- Motorun reddettiği çıktı aynı modele bir kez daha sorulur.
