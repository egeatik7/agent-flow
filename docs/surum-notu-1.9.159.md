# Sürüm notu — 1.9.159

**Taban:** `c643499` (1.9.158 + dev betiği düzeltmesi).

## Ne değişti

- **Rapor kartı (HUD) yukarıda kalıyor.** Döngü çalışırken görünen kart, başka pencereler öne geçince aşağıda kalabiliyordu. Artık her saniye yeniden en üst katmana alınıyor (`electron/main.ts`, `createHud`). Odaklanılamaz ve görev çubuğunda değil; bu özellikler korundu.
- Kart hâlâ ekran görüntüsünde görünmüyor (içerik koruması değişmedi).
- Alt+Tab'ı bozmamak için `moveTop()` kullanılmadı: o, kartı geçiş ekranının üstüne çıkarabilir.

## Bilinen

- `zip-library-storage` / `zip-main-persistence` testlerinde Windows dosya kilidi (EPERM) kararsızlığı sürüyor.
