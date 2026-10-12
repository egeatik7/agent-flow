# Sürüm notu — 1.9.95 (denetim Tur 2: kütüphane kilidi sağlamlaştırma)

**Kaynak**: `Nubbo_1.9.93_Tur2_Patch` → **`Nubbo_1.9.93_Tur2_Artimli.patch`** (Tur 1 zaten 1.9.94 olarak
yayınlandığı için birleşik patch **bilinçli olarak uygulanmadı**). Artımlı patch'in tabanı `77c03aa` =
1.9.94'ün Tur 1 içeriği; yazarın yerel Tur 2 commit'i `a06a970`. Paket sürümü kısmi turlar bitmeden
`1.9.93` bırakılmıştı; yayın zinciri gereği burada **1.9.95**'e yükseltildi.

## Yapılanlar (paketten, zorlamadan `git apply`)

1. **§2.8 — bozuk/boş/yarım kilit** ✓: kilit artık `electron/library-lock.ts` içinde yayınlanıyor;
   kayıt **geçici dosyaya yazılıp `fsync` edildikten sonra `linkSync` ile atomik olarak yayınlanıyor** ✓
   (eski `openSync('wx')` + doğrudan yazım, yarım yazımda boş kilit bırakabiliyordu ✗). Bozuk kayıt
   **60 sn** beklenir; canlı PID içeren kayıt **devralınmaz** ✓; eski sürümlerin bıraktığı boş kilit
   güvenle toparlanır ✓.
2. **§2.9 — ölü kilit devralma yarışı (TOCTOU)** ✓: devralma artık **kurtarma bileti** ile seçiliyor
   (`recover-<sha256>` adları, zincirin her halkası doğrulanır) → aynı ölü nesli **tek** süreç devralır ✓;
   `unlink`+`openSync` yarışı ortadan kalktı ✓. Devralma öncesi anlık görüntü (`raw`+`dev`+`ino`+`mtime`)
   karşılaştırılıyor ✓.
3. **Katalog başına sahiplik ve refcount** ✓: sahiplik **dizin başına nonce** ve referans sayacıyla
   tutulur (`claimLibraryLock`), `withLibraryLock` aynı dizinde yeniden kilit almaz ve **her kullanımda
   sahipliği doğrular** ✓; `release()` yalnız kendi nonce+pid'i eşleşiyorsa siler ✓.
4. **Yayın sonrası temizlik ve sahiplik kaybı** ✓: yayın başarılıysa geçici adın silinememesi
   sahipliği düşürmez ✓; yabancı kilit asla silinmez ✓.
5. **Yeni testler** ✓: `tests/library-lock.test.ts` (**23 test**) ve gerçek süreç yarışı için
   `scripts/test-library-lock-process.cjs` ✓.

## Doğrulama (bu derlemede, Windows'ta yeniden koşuldu)

- Paket bütünlüğü: artımlı patch **SHA256 `3349ff8a…`** ✓ ve 11 kaynak dosyanın **tamamı**
  `Dogrulama.json` ile eşleşti ✓ (birleşik patch `35e34825…` **uygulanmadı** ✗ — kurulum dosyası da
  "tek patch seç" diyor ✓).
- `git apply --check` **geçti** ✓ → **zorlamadan** uygulandı ✓ → `git diff --check` temiz ✓ →
  **ters kontrol** geçti ✓ → uygulanan **11 dosya** paketin kaynağıyla birebir ✓ (yalnız satır sonu farkı).
- `typecheck` ✓ (üç proje) · **Vitest 104 dosya / 778 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.94 tabanı 103/755 → **+23 kilit testi** ✓) · **yeni süreç testi** `test-library-lock-process.cjs`
  ✓ · **beş npm paketi** 97/21/0 ✓ · **on bir PS 5.1 harness'i** exit 0 ✓.
- Kırmızı kanıt: paketin `tur2-red-regressions.log`'u eski depolamaya karşı **19 başarısız** test
  gösteriyor ✓ (düzeltilen davranışların gerçekten ölçüldüğünün kanıtı ✓).

## Sınırlar ve bu turda **alınmayan**

- **Hard link zorunlu**: desteklemeyen dosya sisteminde (FAT/exFAT, bazı ağ paylaşımları) güvenli yayın
  yerine **açık hata** verilir ✓ — üzerine yazma yok ✓. Ancak paketleme raporunun dediği gibi bu bir
  **kullanılabilirlik sınırı**dır: kütüphane klasörü böyle bir birimdeyse kayıt yapılamaz ✗.
- **PID yeniden kullanımı** ve **uzak makine PID kimliği** çözülmedi ✗ (canlı sanılan yabancı kilit
  devralınmaz ✓; ölü sanılan canlı kilit senaryosu açık ✗).
- **Karışık eski/yeni yazıcı** (1.9.94 ile 1.9.95 aynı anda) denenmedi ✗; gerçek Windows/NTFS ve
  fiziksel tablet sınanmadı ✗; portable EXE bu pakette yoktu, bu derlemede `pack:win` ile üretildi ✓.
- Raporun **§2.2–2.6, §2.10** maddeleri ve alan bulguları hâlâ kapsam dışı ✓.
