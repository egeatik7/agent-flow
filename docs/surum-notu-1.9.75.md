# Sürüm notu — 1.9.75 (paket node'una çift tık → içine gir · tuvalde sağ tık → paketten çık)

Kullanıcının **kendi cümlesiyle** verdiği istek ✓: *"paket nodelerine çift tıklayınca direk içlerine gireyim; tuvale sağ tıklayınca da direk bulunduğum paketten dışarı çıkayım."*

## Gelen
- **Paket node'una çift tık → doğrudan içine gir** ✓ (`src/components/NodeCanvas.tsx` ✓): node kartına `onDoubleClick` eklendi ✓;
  **yalnız `kind === 'package'`** için çalışır ✓ (diğer node'larda erken çıkar ✗ ve olayı **durdurmaz** ✗ → mevcut davranış korunur ✓).
  Girdiği mekanizma **zaten var olan** `onEnterPackage` ✓ (`App.tsx:741` → `navigateNode` ✓) — yani yeni bir gezinme yolu **icat edilmedi** ✓;
  tuvalde zaten bulunan **“İçine gir”** düğmesiyle **aynı** işi yapar ✓.
- **Tuvalde sağ tık → bir üst pakete çık** ✓: tuval yüzeyinin `onContextMenu` işleyicisine ✓, **paket içindeyken**
  (`canExitPackage` ✓) doğrudan `onExitPackage` ✓ (`App.tsx:742` → `navigateOut` ✓) eklendi ✓.
  **Kökte davranış değişmedi** ✗: tuval menüsü eskisi gibi açılır ✓ (yeni node ekleme menüsü ✓).
- **Koşu sürerken de çalışır** ✓: 1.9.69'da alınan kararla **gezinti/seçim serbest, düzenleme kilitli** ✓
  (…"Gezinti/seçim ve motorun durum güncellemeleri devam ediyor" ✓) → bu iki jest de **gezinti** sayıldı ✓ ve
  `lockedRef` kontrolünün **önüne** konuldu ✓; **düzenleme** (sürükleme/silme/ekleme) **hâlâ kilitli** ✓.
- Node kartında **sağ tık menüsü** aynen duruyor ✓ (node menüsü, çıkıştan etkilenmez ✓ — olay orada durdurulur ✓).

## Bilinçli küçük kayıp (dürüst ✗)
**Paket içindeyken** tuvalin sağ-tık **menüsü** artık açılmıyor ✗ (sağ tık = çıkış ✓). Paket içinde node ekleme
yine mümkün ✓: **porttan sürükle-bırak** ✓ (menü `mode:'after'` ✓) ve **araç çubuğu** ✓ kullanılabilir ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓ ·
derleme kanıtı: renderer bundle'da `onDoubleClick`/`canExitPackage` yolu ✓.

## Doğrulanmayan (dürüst ✗ — en önemli kısım)
- **Yeni iki jest için test YAZILMADI** ✗: bunlar JSX içinde satır içi işleyiciler ✓ (saf fonksiyona çıkarılmadı ✗),
  `NodeCanvas` ise 30+ prop isteyen büyük bir bileşen ✓ → test için sahne kurmak riskli/abartılı olurdu ✓.
  Yani bu iki davranış **yalnız tip kontrolü + derleme + mevcut paketlerle** sınandı ✓ — **jest testi yok** ✗.
- **Canlı Windows denemesi yapılmadı** ✗ (paketleyip masaüstüne koydum ✓): çift tık/içine gir ✓, sağ tık/çık ✓
  ve **kökte sağ tık menüsünün bozulmadığı** ✗ senin bir denemenle doğrulanmalı ✓.