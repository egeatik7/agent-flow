# Sürüm notu — 1.9.136

**Taban:** `1849192` (1.9.135). Kaynak: `nubbo-gorsel-model-devam-tekrar.patch`.

Görsel hedefleme, başladığı model zincirinde devam eder. Motorun reddettiği çıktı aynı modele bir kez daha sorulur.

## Ne değişti

- Tıkla görsel listesini kullanır. Yap, kendi ajan listesinde kalır. Görsel liste boşsa metin modeli yedeği durur.
- Bir yedek hedefi bulursa popup, kırpma ve imleç kontrolü o modelle sürer. Aynı işlemde zincir değişmez ve akış JSON'una yazılmaz.
- Bozuk veya eksik çıktı aynı modele ikinci bir deneme verir. İkinci red sonraki modele geçer. `null`, `missing` ve `uncertain` bozuk sayılmaz. HTTP, kredi ve bağlantı hataları bu denemeye girmez.
- Model sırası değişiklikleri doğrudan kaydedilir. Elle yazılan ad Enter veya alandan çıkınca kaydolur. Her listede sunucunun onayladığı kayıtlı sıra görünür.

## Ölçüm

- `git apply --check` geçti, `--force` kullanılmadı.
