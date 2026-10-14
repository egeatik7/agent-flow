# Sürüm notu — 1.9.141

**Taban:** `1aa9331` (1.9.140) ve `nubbo-yontem-fallback-139.patch`.

## Ne değişti

- Görsel onay tıklama gitmeden reddedilirse sıradaki açık yöntem yeni taramayla denenir. Sıra korunur, kapalı yöntem açılmaz, görsele baştan dönülmez.
- Hedef bir kez yenilenip aynı talimatla aranır. Üçüncü arama ve `lookFor` ile hedef değiştirme yok.
- Kayıtlı konum yalnız son çaredir ve tıklanır. Koordinat yoksa nokta uydurulmaz.
- Gönderilmiş ve sonucu belirsiz girdi ayrı durur; ikisi de kör ikinci basmayı engeller.
- Yöntemler tükenirse Kurtarma Ajanı önce bakar. Toparlayamazsa döngü aynı öğede durur.
