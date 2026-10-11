# Sürüm notu — 1.9.91 (tablet yerleşimi + sekme genişliği düzeltmeleri)

**Kaynak** ✓: `Nubbo_1.9.90_1.9.91.patch` ✓ (**artımlı** ✓, **5 dosya** ✓, düz `git apply --check` = **0** ✓,
SHA256 `8819176d…` ✓). Pakette ayrıca **`Nubbo_Main_1.9.91.patch`** var ✗ (**birikimli** ✗, 51 dosya ✓,
`--check` **başarısız** ✗: `README.md:18` ✓, `a11y/screen.ps1:762` ✓, `android-viewer/… already exists` ✓) → benim ağacım
**1.9.90** olduğu için **artımlı patch uygulandı** ✓; birikimli olan **uygulanmadı** ✗ (**zorlama yok** ✗).

**Uygulama** ✓: `git apply --exclude=package.json --exclude=package-lock.json` ✓ — çünkü `package.json` farkı **yalnız
sürüm satırıydı** ✓ (`1.9.90 → 1.9.91` ✓) ve sürümü ben **aynı numaraya** çıkardım ✓. Değişen **3 kod/CSS dosyası** ✓:
`src/components/TabletDialog.tsx` ✓ · `src/styles/workspace.css` ✓ · `src/viewer/viewer.css` ✓.

## Gelen (`Kurulum.txt`'ten ✓)
1. **Tablet tuval yüksekliği ve ekran boyutuna göre panel yerleşimi** düzeltildi ✓.
2. **Tablet İzleme** penceresine **XP başlığı** ✓, **üst kapatma düğmesi** ✓ ve **sınırlı pencere ölçüleri** ✓ geldi.
3. **Üst tuval sekmeleri 80 px** ✓ ve **tam isimler korunuyor** ✓.
4. Node ve web arayüzü güncellemeleri **PC'den** geldiği için **APK yeniden kurulmuyor** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest** ✓ · **beş npm paketi** ✓ (skip sayılarıyla ✓) · **sekiz Node regresyon** ✓ ·
**PS 5.1'de 10 harness** ✓ (**paket bunları koşmadı** ✗) · `pack:win` ✓ · **masaüstü kopyası hash ile doğrulandı** ✓ ·
**ASAR'ın içinden** izler ölçüldü ✓.
Paketin **kendi `Dogrulama.json`'u** ✓: **41 ilgili test** ✓ + **gerçek tarayıcı yerleşim ölçümleri** ✓ (1280×800 ✓,
**800×1280 dikey** ✓, 720×480 ✓ + **eski yerleşimle karşılaştırma** ✓ + sekme genişliği **80 px** ✓, kapatma **16 px** ✓) —
ölçümler düzeltilen hatayı **sayısal** olarak gösteriyor ✓: eski yerleşimde tuval yüksekliği **198 px** ✗ iken yenisinde
**543 px** ✓.

## Doğrulanmayan (dürüst ✗)
- **Fiziksel Windows/Android etkileşimi denenmedi** ✗ (`Dogrulama.json`: `physical_windows_android_tested: false` ✓).
- **Tablet yerleşimi yalnızca tarayıcı ölçümleriyle** doğrulandı ✓ → **gerçek tablette görülmedi** ✗.
- **APK hâlâ pakette yok** ✗ → yalnız **PC tarafı** teslim edildi ✓.
- Paketin **`exe_sha256`** değeri benim derlememle **aynı olmayacak** ✗ (farklı makine/zaman ✓; aynı kaynak ✓).