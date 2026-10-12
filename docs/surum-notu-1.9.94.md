# Sürüm notu — 1.9.94 (denetim Tur 1: iki yazar sınırı + kütüphane reload toparlanması)

**Kaynak**: `Nubbo_1.9.93_Tur1_Patch` (başlangıç commit'i `5f1f81d`, yazarın yerel commit'i `77c03aa`,
dal `fix/audit-1.9.93-session-1`). Paket, **1.9.93 tam proje bug taraması raporunun** (§2.1 ve §2.7)
düzeltmelerini ve yeni bir göç bulgusunu taşır. Paket sürümü bilinçli olarak `1.9.93` bırakmıştı;
yayın zinciri gereği burada **1.9.94**'e yükseltildi.

## Yapılanlar (paketten, zorlamadan `git apply`)

1. **§2.1 — araç katmanının branch kayıtları artık kalıcı** ✓ (`electron/workspace-store.ts`,
   `electron/main.ts`). Son kayıt sınırına **yazıcı ayrımı** eklendi: `WorkspaceWriter = 'window' | 'tools'`.
   `writeWorkspace(..., writer)` artık `window` yolunda `windowSave`, `tools` yolunda
   `toolLayerSave` uyguluyor — eskiden araç kaydı da `windowSave`'den geçip **yeni branch listesini
   bayat mağaza kopyasıyla değiştiriyordu** ✗. `main.ts`'teki `saveCanvases` artık
   `storeWorkspace(book, 'tools')` çağırıyor ✓.
2. **§2.7 — reload sonrası dış katalog artık ezilmiyor** ✓ (`src/App.tsx`). Taze katalog
   **`adoptBook({ ...commitActive(), library })`** ile oturum kitabına aktarılıyor ✓; açık tuval, paket
   görünümü, otomasyon taslağı ve **kayıt karşılaştırma tabanı korunuyor** ✓; reload **bekleyen yazımlar
   boşalmadan** başlamıyor ✓ (bu arada yeni bayat otomatik kayıt kuyruğa giremiyor ✓).
3. **Yeni bulgu — göç edilmiş profilin her okunuşta yeniden aktarımı** ✓ (`readWorkspace` artık
   `catalog?: CanvasLibrary` alıyor). `librarySession` kütüphaneyi oturumdan çıkardığı için önceki okuyucu
   her okumayı "legacy aktarım" sanıp **`savedId` alanlarını sekme kimlikleriyle değiştiriyordu** ✗.
   `libraryMigrated` işaretli profil artık ayrı katalogla okunuyor ✓; eski JSON'ların ilk aktarım yolu korunuyor ✓.

Akış JSON şeması, node türleri, paket/döngü motoru **değiştirilmedi** ✓.

## Doğrulama (bu derlemede, Windows'ta yeniden koşuldu)

- Paket bütünlüğü: patch **SHA256 `9daa4dae…`** ✓ ve 7 dosyanın **tamamı** `Dogrulama.json` ile eşleşti ✓.
- `git apply --check` **geçti** ✓ → **zorlamadan** uygulandı ✓ → `git diff --check` temiz ✓ →
  **ters kontrol** geçti ✓ → uygulanan 7 dosya paketin kaynağıyla **birebir aynı** ✓ (yalnız satır sonu farkı).
- `typecheck` ✓ (üç proje) · **Vitest 103 dosya / 755 geçti / 1 atlandı / 0 kırmızı** ✓
  (taban 750 → **+5 yeni test** ✓; yeni testler artık **gerçek `main.ts` gövdelerini AST ile çıkarıp**
  VM'de koşturuyor ✓ — eski eleştiri "yalnız saf fonksiyon test edildi" kapandı ✓).
- **Beş npm paketi** ✓ (97 geçti / 21 atlandı / 0 kırmızı; tabanla aynı ✓) · **on bir PS 5.1 harness'i** ✓.
- Kırmızı kanıt: beş yeni test **taban koduna karşı 5 başarısız** ✓ (paketin `tur1-red-regressions.log`'u
  beklenen veri kaybını yeniden üretiyor ✓).

## Doğrulanmayan / bu turda **alınmayan**

Raporun §2.2–2.6, §2.8–2.10 maddeleri ve alan bulguları **bu turda kapsam dışı** ✓: tuş yolunda hedef pencere
denetimi ✗ · `inputState` toleransı ✗ · Koşul öncesi doğrulanmamış memo ✗ · Koşul bekleme bütçesi ✗ ·
%TEMP% süpürmesinde canlı örnek koruması ✗ · kilit yazımı/kurtarma/devralma ✗ · `applyPlan` üyelik kapanışı ✗.
Gerçek Windows masaüstü, canlı iki Nubbo süreci, disk erişim hatası ve fiziksel tablet **sınanmadı** ✗;
packager'ın Linux ortamındaki `build:electron` kanıtı bu derlemede `pack:win` ile **yenilendi** ✓.
