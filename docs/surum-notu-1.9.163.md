# Sürüm notu — 1.9.163 (giriş yolu: etiket→alan, Ctrl+A geri düşüşü, gözlem eylemi engellemez)

**Taban:** `3fd41d7` (1.9.162). Node türleri/şemaları değişmedi.

## Ne değişti

1. **Yazı Yaz: etikete tıklanınca komşu alan artık odaklanıyor** (`a11y/worker.ps1`).
   Klasik Win32 formlarında (FolderBatcher) alanların UIA adı içeriktir, başlık ayrı `Static`tir;
   başlığa tıklamak klavye odağını komşu `Edit`e taşımaz. Köprü artık tıklama noktasını da
   gönderdiği için, odak yazı alanı değilse tıklama noktasının komşuluğundaki **tek** yazı alanı
   bulunup odaklanıyor (eylem; ret yok). Birden çok aday varsa davranış eskisi gibi kalır.
2. **Ctrl+A'yı yok sayan klasik Edit kutuları temizleniyor** (`a11y/worker.ps1`).
   `^a → DEL` sonrası alan okunur; metin kaldıysa `EM_SETSEL` ile seçilip yeniden silinir ve
   `cleared` alanı gerçek sonuca göre yazılır (okunamıyorsa "bilinmiyor ≠ kaldı").
3. **`ensureActed` taramaları eylemi engellemiyor** (`electron/agent.ts`). Önce/sonra taraması
   hata verirse eylem yine yapılır; sonuç "doğrulanamadı" sayılır, adım hata olmaz. Eski hal
   tıklamayı hiç göndermiyor ya da başarılı tıklamayı `haltLoop`'lu hataya çeviriyordu.
4. **Bitir'e giden koşuda `incomplete` kaybolmuyor** (`electron/runner.ts`): paket içinde yarım
   kalan koşul, dış akış Bitir'e girse de "tamamlandı" sayılmaz.
5. **Durdur kısayolu kaydı sessiz değil** (`electron/main.ts`): `Ctrl+Shift+Q` başka uygulamada
   kayıtlıysa günlüğe uyarı yazılır (pencere gizliyken tek durdurma yolu).
6. **Koşu bitince model kronometresi duruyor** (`electron/main.ts`): kart koşu sonrası canlı
   "Model cevabı bekleniyor · N sn" göstermiyor.
7. **`act.wait` istenen süreden kısa kesilmiyor** (`electron/tools.ts`): 60 sn tavanı yerine
   `ms + 30 sn` (en az 60 sn). 5 dakikalık bekleme 60. saniyede "hata" olmuyor.
8. **Bellek ölçümü boş çıktıyı "başarılı ölçüm" saymıyor** (`electron/memory-meter.ts`): boş/timeout
   çıktıda `indexOf('{') = -1` iken `slice(-1)` son karakteri alıyordu; artık ölçüm başarısız sayılır
   ve son geçerli örnek korunur.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **193 dosya / 1472 test** yeşil.
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**. (`test:stability` harness'ine `durdurHudStopwatch` yüzeyi eklendi;
  gerçek `runFlow` bu adı çağırıyor.)
- PowerShell harness: `test-worker` (adjacent label + klasik Win32 form + native Edit odak
  kontrolleri dâhil) **geçti**, `test-keyboard-safety` ve `test-visual-input` geçti. Bilinen 4 kırmızı
  (`test-direct-input`, `test-hover-worker`, `test-key-input`, `test-input-recovery`) bu sürümün
  konusu değil; 1.9.160 notundaki `XpKeyboardGuard` harness yüzeyi sorunu aynen sürüyor.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Gerçek Windows formunda uçtan uca denenmedi.** Etiket→alan ve `EM_SETSEL` yolu, worker'ın
  gerçek UIA/Win32 çağrılarıyla canlı bir FolderBatcher penceresinde sınanmadı; `test-worker`
  harness'i fonksiyon sözleşmelerini, `test:input`/`test:recovery` Node paketleri köprü
  sözleşmesini sınıyor.
- Aday alan sayısı birden fazlaysa seçim hâlâ yapılmıyor (eski davranış): bu sürümde "tek komşu
  alan" durumu düzeltildi.
- `screenCheck=off` modunda hafızaya doğrulanmamış hedef yazılması (tarama raporundaki H6/§17
  bulgusu) bu sürümde ele alınmadı.
