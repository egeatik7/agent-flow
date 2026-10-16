# Sürüm notu — 1.9.153

**Taban:** `5ef47d1` (1.9.152).

## Ne değişti

- **Masaüstü kısayolu, görev çubuğunda çıktı:** Eskiden tıklamadan duruyordu. Artık uyarı yazıp görev çubuğundaki öğeyle devam ediyor. (`electron/agent.ts`, hedef çözümleme.)

## Bilerek değişmeyenler (karar: kullanıcı)

- Fare konumu okunamazsa girdi gönderilmez; hata adım hatası olarak günlüğe düşer.
- Kayıtlı devam noktası birden fazla satırda ise devam etmez.
- Yazı alanı değiştiyse yazı gönderilmez; kurtarma ajanı açıksa yazma adımında devreye girer.
- "Koşul" düğümünde hiçbir yöntem karar veremezse durur (karar bekliyor).

## Bilinen

- Görev çubuğundaki öğe, masaüstü simgesinin yerine geçer. Uygulama kapalıysa açılmayabilir; bu durumda adım sonucu zaten doğrulanmaz.
- Bu değişiklik için birim testi yok (karar, kapatma fonksiyonu içinde); tip kontrolü ve mevcut geçit ile doğrulandı.
- `zip-library-storage` testi bilinen kararsız (EPERM).
