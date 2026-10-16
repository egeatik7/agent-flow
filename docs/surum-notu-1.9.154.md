# Sürüm notu — 1.9.154

**Taban:** `51bca55` (1.9.153).

## Ne değişti (davranış değişikliği)

Koşul düğümü, "hayır" ya da "karar veremedim" dediğinde, hayır çıkışına göre:

- **Hayır çıkışı bağlıysa:** akış o düğüme gider. (Değişmedi.)
- **Hayır çıkışı boşsa, kurtarma ajanı kapalıysa:** koşu durur ve hata verir. Önceden sessizce "tamamlanmadı" olarak bitiyordu.
- **Hayır çıkışı boşsa, kurtarma ajanı açıksa:** kurtarma ajanı ekrana bakıp "var" ya da "yok" der.
  - "var" → akış evet çıkışından devam eder.
  - "yok" → koşu durur (hayır çıkışı boş olduğu için).

Kurtarma ajanı bu durumda yalnızca ekran okuyabilir ve "var/yok" bildirebilir; tıklama, yazma veya tuş gönderemez.

**Kapsam:** Bu kural yalnızca üst düzey akışta çalışır. Paket içinde ve Her Öğe İçin kutusunun içinde, bağlantısız hayır çıkışı eski davranışını korur (paket/kutu çıkış mantığını bozmamak için).

## Testler

- `tests/condition-recovery.test.ts` (11): evet, bağlı hayır, boş hayır × (kapalı / var / yok / durdur), karar veremedi × bağlı/boş, kurtarma ajanı Koşul modunda ekran okumadan karar veremez ve tıklayamaz.
- Eski testlerden 4'ü yeni kurala göre güncellendi (üst düzey bağlantısız hayır artık durur). Paket içi davranış aynı kaldı.
- Kasıtlı hata enjeksiyonu ile (kurtarma "yok" yerine "var" döndürülünce) testlerin yakaladığı doğrulandı.

## Bilinen

- Bu kural kurtarma ajanına model yargısı (var/yok) yetkisi verir. Yanlış "var" riski vardır; kurtarma ajanının kanıt zorunluluğu (ekran okuma sonrası) ile sınırlandı.
- `zip-library-storage` testi bilinen kararsız (EPERM).
