# Sürüm notu — 1.9.135

**Taban:** `36bc5bb` (1.9.134). Kaynak: `nubbo-tuval-ctrl-f.patch`.

Tuvalde Ctrl+F araması. Node komutları, OCR/LLM davranışı ve kayıtlı akış JSON'ları aynı kaldı.

## Ne değişti

- Fare tuvalin üzerindeyken Ctrl+F arama kutusunu açar. Metin kutusu, başka bir sekme veya tuvalin dışı tuval aramasını açmaz.
- Arama Enter veya Ara ile başlar. Yazarken arama yapılmaz.
- Oklar ve ekrandaki düğmeler sonuçları gezer. Paketler ve döngü nodeleri dahildir. Sonuç nodeyi ortalar ve ayarını açar.
- Sekme değişince arama kapanır.

## Ölçüm

- `git apply --check` geçti, `--force` kullanılmadı.
