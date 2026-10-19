# Sürüm notu — 1.9.161 (Checkpoint düğmesi araç çubuğunun sağ ucuna taşındı)

**Taban:** `63a78dc` (1.9.160). Yalnız arayüz yerleşimi değişti; checkpoint mantığı, dosya takibi
kapsamı, ayarlar ve akış davranışı **aynen** korundu.

## Ne değişti

- "Checkpoint’ler ve çıktılar" düğmesi, **durum çubuğunun (`… · hedef: tüm ekran`) hemen altındaki
  araç çubuğunun sağ ucuna** taşındı. Düğme artık `Toolbar` içinde (`onOpenCheckpoints`), kendi
  satırındaki `div` kaldırıldı: tuvalin üstünde fazladan boş bir şerit yok.
- Yerleşim kuralı: `.toolbar .tb-right { margin-left: auto }`. Araç çubuğu sardığında (dar pencere)
  düğme kendi satırında **sağda** kalır; geniş pencerede diğer düğmelerle aynı satırdadır.
- Panel davranışı değişmedi: aynı düğme paneli açar; `running`/`editorLocked` durumunda pasif.

## Doğrulama

- Gerçek Chrome'da **gerçek `Toolbar` bileşeni + gerçek CSS** ile ölçüldü:
  - 1440 px: sağ boşluk **6 px** (araç çubuğu iç boşluğu), çubuk yüksekliği 37 px → düğme **ilk
    satırda sağ uçta**.
  - 900 px: çubuk 65 px, düğme ikinci satırda **sağa yaslı** (sarma davranışı).
  - Ölçüm geçici bir denetimle yapıldı ve denetim dosyası repoya **eklenmedi**.
- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **184 dosya / 1420 test** geçti (düğme metnini/akışını kullanan mevcut UI
  testleri dâhil).
- `npm run build:electron` ✓ (paket ile birlikte).

## Sınır

- Tam uygulama penceresi açılıp gözle bakılmadı; ölçüm bileşen düzeyinde, gerçek tarayıcı düzeninde
  yapıldı.
- Dar pencerede düğme ikinci satıra sarkıyor (araç çubuğu `flex-wrap`). Yerleşimi tek satıra
  zorlamak mevcut düğmelerin sırasını/ölçüsünü değiştirmek demek olurdu; bu sürümde yapılmadı.
