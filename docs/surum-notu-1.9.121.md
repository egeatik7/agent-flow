# Sürüm notu — 1.9.121 (masaüstü kartındaki üst üste binme düzeltmesi)

**Kullanıcı bildirimi:** “Masaüstü kartında bug oldu; kart böyle üst üste açılıyor, konuşma kutusunda görsel bir bug.”

## Kök neden (ölçüldü)

HUD penceresi **sabit yükseklikteydi** (`HUD_H = 164`) ve kart **CSS grid** ile yerleşiyor
(`.hud-method` → `grid-row: 2`, `.hud-loop` → `grid-row: 3`). 1.9.119/1.9.120’de karta iki satır eklendi
(model kronometresi + aşama şeridi) ve döngü satırına `white-space: normal; word-break: break-word`
verildi. Böylece uzun döngü yolu (ör. `Grup 3/12 · Image Folder › Öğe 7/20 · kedi.png`) tek grid
hücresinde **2–3 satıra sarıyor**, sabit yükseklikli pencerede taşarak kartın üstüne biniyordu.

## Düzeltme

- `src/styles/xp.css`: `.hud-line.hud-loop` ve `.hud-stages` artık **tek satır + kırpma**
  (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). Sarma/`word-break`, gereksiz
  kenarlık ve iç boşluk kaldırıldı; aktif döngü satırındaki `font-weight` (genişliği değiştirip yeniden
  taşmaya yol açabiliyordu) kaldırıldı.
- `electron/main.ts`: `HUD_H` **164 → 196** (kronometre ve şerit satırlarına yer). Pencere konumu aynı
  mantıkla hesaplanıyor; sağ alt köşe korunuyor.

## Doğrulama

- `npm run typecheck` ✓ · **Vitest 120 dosya / 887 geçti / 0 kırmızı**.
- Görsel doğrulama **kullanıcı gözüyle** yapılmalı: bir koşuda kartta satırlar tek satır kalmalı,
  üst üste binme olmamalı. (Bu bir görsel düzeltmedir; birim testi görünürlüğü ölçmez.)
