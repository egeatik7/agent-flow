# Sürüm notu — 1.9.148

**Taban:** `b7a8138` (1.9.147). `nubbo-zamanlama-03.patch`. Zamanlama 02 bu dalda yoktu; yama 1.9.147 üzerine temiz oturdu.

## Ne değişti

- Yap turunda OpenRouter hesap reddi, sağlıklı yerel yedeği engellemez. Aynı reddedilmiş hesapla o turda yeniden istek atılmaz.
- Uzun teknik model hataları tek geçici gözlem olarak durur. Görev, bağlam ve tamamlanmış araç sonucu silinmez.
- Yalnız bekleme, gönderilmiş girdi sayılmaz. Önceden tuş veya tıklama gittiyse bayrak durur.
- Görüntü kapalı yerel Yap, ekran okumasından sonra metinle modele tekrar ulaşır. Uzak yedek görüntüyü almaya devam eder.
- Hem metni hem aracı boş cevap geçersiz sayılır ve sıradaki model denenir. Metinsiz geçerli araç çağrısı kabul edilir.
