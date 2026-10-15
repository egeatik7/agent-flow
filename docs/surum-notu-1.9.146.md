# Sürüm notu — 1.9.146

**Taban:** `b555f53` (1.9.145). `nubbo-kurtarma-devri-145.patch`.

## Ne değişti

- Hedef modelleri koşuyu bilinçli vazgeçmeyle bitiremez. Görsel terminate, liste give_up ve id:null, yöntem sonucu alınamadı demektir.
- Yöntemler tükenince aynı düğüm ve döngü öğesi kurtarmaya devredilir. Kurtarma kapalıysa bu yazılır ve öğede durulur.
- Kurtarmanın açık stop kararı ayrıdır. Araç, süre veya API arızası ayrı kurtarma başarısızlığıdır.
- Yap task_give_up görevi bitirmez; kurtarmaya geçer. Kurtarma otomatik açılmaz. Alt+Tab’a özel kural yok.
