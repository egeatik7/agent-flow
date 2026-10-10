# Sürüm notu — 1.9.76 (sağ tık menüsünden "Node ekle" kaldırıldı · **Shift+A** imlecin olduğu yerde açar)

Kullanıcının **kendi cümlesiyle** verdiği istek ✓: *"sağ tıklayınca açılan node ekle özelliğini sağ tıktan kaldır. Shift+A basınca açılsın o pencere, mousemi tuvale tutuyorsam mousenin üzerinde açılsın."*

## Gelen
- **Tuvalde sağ tık artık "Node ekle" penceresini AÇMAZ** ✗: yüzeyin `onContextMenu` işleyicisinden `setMenu({ mode: 'canvas' })` **kaldırıldı** ✓. `e.preventDefault()` **kaldı** ✓ (yerel/tarayıcı menüsü çıkmaz ✓) ve **paket içinde sağ tık = bir üst pakete çık** ✓ (1.9.75 ✓) **aynen** duruyor ✓. Node kartının kendi sağ-tık **menüsü** (çalıştır / kutuya al / kopyala / sil ✓) **etkilenmedi** ✓.
- **Shift+A** o pencereyi açar ✓: mevcut **Escape tuş dinleyicisi genişletildi** ✓ (aynı `useEffect` ✓). **Fare tuvalin üzerindeyse** pencere **imlecin tam olduğu noktada** açılır ✓ (`pointerRef` ✓ + `onMouseMove`/`onMouseLeave` ✓; ekran→tuval dönüşümü `scrollRef` dikdörtgeni + `viewRef` ile ✓ — yakınlaştırma/kaydırma dahil ✓). **Tuvalin dışındaysa** görünümün **ortasında** açılır ✓.
- **Menü içeriği DEĞİŞMEDİ** ✓ (aynı node listesi ✓, "Node ekle" başlığı ✓, tıklayınca menünün açıldığı noktaya ekler ✓). Porttan sürükleyerek gelen **"İleriye ekle"** yolu ✓ (`mode: 'after'` ✓) **değişmedi** ✓.

## Koruma kuralları (bilinçli ✗)
- **Yazı alanındayken açılmaz** ✗: `input` / `textarea` / `select` / `contenteditable` odaktaysa Shift+A **yutulmaz** ✓ → yazarken **A** tuşu menü açmaz ✓.
- **Ctrl/Cmd/Alt ile birlikte açılmaz** ✗ → **Ctrl+A** (tümünü seç ✓) **bozulmaz** ✓.
- **Koşu sürerken açılmaz** ✗ (`lockedRef` ✓ — 1.9.69 kararı: koşarken **düzenleme kilitli** ✓, ekleme **düzenlemedir** ✓).
- **Escape** yine kapatır ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓ ·
derleme kanıtı: renderer bundle'da `pointerRef`/Shift+A yolu ✓.

## Doğrulanmayan (dürüst ✗)
- **Bu jest için test yazılmadı** ✗ (satır içi JSX işleyicisi ✓): yalnız **tip kontrolü + derleme + mevcut paketler** ✓.
- **Canlı Windows denemesi yapılmadı** ✗ → şunlar senin denemenle doğrulanmalı ✓: (1) sağ tık **menü açmıyor** ✗;
  (2) **Shift+A** pencereyi **imlecin olduğu yerde** açıyor ✓ (yakınlaştırılmış/kaydırılmış görünümde de ✓);
  (3) **yazı alanında** A yazınca menü **açılmıyor** ✗; (4) **Ctrl+A** ile tümünü seçme **çalışıyor** ✓;
  (5) **paket içinde sağ tık** hâlâ **bir üst pakete çıkarıyor** ✓.