# Sürüm notu — 1.9.66 (Nubbo-XP: XP tek tema + çalışma alanı ve düğüm hiyerarşisi)

Kaynak: kullanıcının `Nubbo-XP` paketi (snapshot + **üç** patch). `agent-flow/docs/XP-WORKSPACE.md` patch
tabanlarını veriyor ✓: `agent-flow-cumulative.patch` → taban **`6edcdcc`** ✓; **`agent-flow-update.patch`**
→ **`4cedcea`** ✓ (*"the last completed Aero/canvas-save revision"* ✓); `agent-flow-from-checkpoint.patch`
→ `c826830` ✓. Ölçtüm ✓: **`agent-flow-update.patch` düz `--check` = 0** ✓ (benim ağacım tam o durumda ✓,
1.9.65 = Aero + canvas-save ✓), kümülatif ✗ ve checkpoint ✗ **uygulanamaz** ✗ → **yalnız update'i**,
**zorlamadan** uyguladım ✓; `git diff --check` **0** ✓; **35 giriş** ✓ (13 silme ✗ + 18 değişen ✓ + 4 yeni ✓).

## Gelen
- **XP artık TEK tema** ✓: **Aero stilleri, tema geçişi, maskot/logo varyantları ve bütün Aero varlıkları
  KALDIRILDI** ✗ — `src/styles/aero.css` ✗, `src/lib/theme.ts` ✗ (+ `tests/theme.test.ts` ✗),
  `docs/aero-reskin/` (9 dosya ✗), `src/assets/nubbo-aero.png` ✗, `nubbo-logo-aero.png` ✗.
  **Ölçüm: src+electron içinde `aero` izi = 0** ✓. **Orijinal animasyonlu XP maskotu korundu** ✓.
- **Boş çalışma alanı** ✓: **Tuval Aç** ✓, **Otomasyon Aç** ✓, **Yeni Tuval Oluştur** ✓ (XP tarzı SVG
  ikonlar ✓); ilk ikisi **katalog seçici** açar ✓; boş katalog **nerede oluşturulacağını** söyler ✓;
  **boş otomasyon açılamaz** ✓. (`src/components/WorkspaceWelcome.tsx` ✓)
- **Maskot, logo ve sürüm Tuvaller'in ALTINDA** ✓; üstteki katalog **bağımsız kayar** ✓; dar ekranda marka
  orantılı küçülür ✓.
- **Boş tuvale tıklama Düğüm hiyerarşisini geri getirir** ✓: **her node** görünür ✓ — **bağlantısız
  node'lar** ✓, **iç içe paketler** ✓ ve **döngüler** ✓; **açık çerçeve üyeliği öncelikli** ✓; eski
  grafiklerde **döngü-dönüş yolları** ilgili döngünün içinde görünür ✓; bu **çıkarımsal gruplama yalnız
  listeyi etkiler** ✓, **kayıtlı üyelikleri/bağlantıları DEĞİŞTİRMEZ** ✓ (`src/lib/canvas-hierarchy.ts` ✓ +
  `src/components/NodeHierarchy.tsx` ✓).
- **Klasör aç/kapa + Tümünü Aç/Kapat** ✓; **açılma durumu** aynı tuvalde node incelerken **korunur** ✓;
  satıra tıklama **paket yolunu açar, node'u seçer ve ortalar** ✓; gezinme, düzenlenen paket görünümünü
  **ebeveyne yazar** (kaydedilmemiş düzenlemeler paketler arası geçişte kaybolmaz ✓).
- **XP kaydırma çubukları** ✓ (yukarı/aşağı + sol/sağ **ok görselleri** ✓, her uçta bir düğme ✓);
  **tuval sekmeleri yalnız yatay kayar** ✓ (eski OCR/tema alanındaki **istenmeyen dikey çubuk gitti** ✓);
  **kullanılmayan OCR seçici stilleri** ve **eskimiş yardım girdisi** kaldırıldı ✓ (OCR **Ekran Tarayıcı**
  üzerinden çalışmaya devam eder ✓).
- **Kalıcılık korunuyor** ✓: boş açılış ✓, kapatırken **her değişen tuvali gözden geçir** ✓,
  **Kaydet/Vazgeç/İptal** ✓ ve **otomasyon kapsayıcı listelerinin otomatik kalıcılığı** ✓.

## Değişmeyenler
**Yürütme, OCR, LLM ve girdi motoru** bu XP çalışma alanı güncellemesinden **etkilenmedi** ✓.

## Doğrulama
- **10/10 mevcut dosya «İÇERİK AYNI»** ✓ (referans snapshot ile ✓: `App.tsx` ✓, `xp.css` ✓,
  `WorkspaceWelcome.tsx` ✓, `NodeHierarchy.tsx` ✓, `CanvasLibrary.tsx` ✓, `NubboMascot.tsx` ✓,
  `canvas-library.ts` ✓, `graph-types.ts` ✓, `main.ts` ✓, `preload.ts` ✓) — satır sonu normalize ✓.
- Silinen dosyalar referansta da **yok** ✓ (`theme.ts` ✓, `aero.css` ✓).
- `typecheck` ✓ · `build:electron` ✓ · **Vitest 68 dosya / 513 test** ✓ (paketin 508'i + Windows'a bağlı
  5 atlamanın tamamı koştu ✓) · **beş npm paketi** ✓ · **sekiz Node regresyon dosyası 117/0** ✓ ·
  `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
- **Canlı görsel denetim yapılmadı** ✗ — XP **kaydırma çubuğu okları**, **boş çalışma alanı** seçicileri,
  **hiyerarşi** (bağlantısız/iç içe/döngü), **marka yerleşimi** (dar ekran ✓), **kapatma diyaloğu** ve
  **Windows ölçeği** denenmedi ✗ (paketin kendisi de **tarayıcı bulamadığı için ekran görüntüsü
  alamadığını** yazıyor ✓ — ben de **iddia etmiyorum** ✗).
- Aero **artık yok** ✗ (istenen budur ✓); geri dönmek istersen önceki sürümler (1.9.64/1.9.65) masaüstünde
  duruyor ✓.