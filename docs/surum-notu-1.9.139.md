# Sürüm notu — 1.9.139

**Taban:** `f70671f` (1.9.138).

## Ne değişti

- Kütüphane kilidi, dosya dışarıdan silinmişse eski kaydı unutup yeniden alıyor. Async iş bitene kadar kilit duruyor; senkron iş eskisi gibi hemen bırakılıyor.
- Silinen düğüm, `members` dizisi olan düğümlerden çıkarılıyor. Bu alanı olmayan düğümlere eklenmiyor.
- Paketten üst katmana çıkarken durdurma isteği kontrol ediliyor.
- Görsel hedefin sağ ve alt kenarı (`1000`) artık reddedilmiyor.
