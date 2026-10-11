# Sürüm notu — 1.9.93 (üç bölüm: Tuvaller · Arşivlenmiş Tuvaller · Otomasyonlar)

**Kullanıcı isteği**: (1) **Otomasyonlar sekmesinde tuval klasörü görünmemeli** (bug) ✓; (2) yapı **Tuvaller** ·
**Arşivlenmiş Tuvaller** · **Otomasyonlar** olmalı ve **otomasyonlarda arşiv diye bir şey olmamalı** ✓;
(3) kütüphane yapısı **tertemiz ve bugsuz** kalmalı ✓; (4) bu alandaki **her türlü sıkıntı/gereksiz detay** düzeltilmeli ✓;
(5) üst tuval sekmeleri **yeniden renksiz** olmalı ✓.

## Yapılanlar
1. **Üç sekme** ✓ (`canvases` · `canvas-archive` · `automations`); arşiv artık **ayrı sekme** ✓, ayrı
   **Kütüphane/Arşiv araç çubuğu kaldırıldı** ✓; `archived` **view'den türetiliyor** ✓ (ayrı state değil ✓).
2. **Otomasyonda arşiv yok** ✓: arşiv maddesi yalnız tuval bölümlerinde çizilir ✓; `archive` işleminde
   **otomasyon başvuruları atlanır** ✓ (kalanlar arşivlenir ✓, hata verilmez ✓); `LibraryTree` otomasyon modunda
   **arşiv süzgecini hiç uygulamaz** ✓ → eski `archived` bayrağı bir otomasyonu **gizleyemez** ✓.
3. **Katı bölüm + güvenli göç** ✓: klasörler artık `f.section === bolum` ile süzülüyor ✓ (eskiden **bölümsüz klasörler
   iki sekmede de** görünüyordu ✗ — bildirdiğin bug ✓). Bunun güvenli olması için **`ensureSections` yeniden yazıldı** ✓:
   **alt ağacın tamamına** bakar (aşağıdan yukarı ✓), **deterministiktir** (id üretmez ✓), tek tür içeren alt ağaç o
   bölüme bağlanır ✓, **hem tuval hem otomasyon** içeren alt ağaç **bölümsüz kalır ve iki bölümde de görünür** ✓ →
   **hiçbir kayıt görünmez kalmaz** ✓. Artık `load` **+ `save` + `restore`** yollarında çalışır ✓. Ayrıca `LibraryTree`
   **ebeveyni görünmeyen öğeyi köke bağlar** ✓ ve `library-database`'te **klasörleri atlayabilen `shape` bayrağı**
   etkisizleştirildi ✓.
4. **Temizlik/tutarlılık** ✓: yeni klasör **üst klasörün bölümünü devralır** ✓; **aynı ad yalnız AYNI bölümde yasak** ✓
   (iki bölüm bağımsız ağaç ✓); `claim()` ikinci çağrıda ham `EEXIST` fırlatmaz ✓; kütüphane değiştirilirken **eski
   kilit bırakılır, yenisi sahiplenilir** ✓; `save()` dosya okunamazsa **açık mesaj** verir ✓; kaldırılan kurtarma
   panelinin **ölü prop'ları silindi** ✓.
5. **Renksiz sekmeler** ✓: `CanvasTabs`'ten **palet/`--tab-hue`** kodu ve `workspace.css`'teki
   `hsl(var(--tab-hue)…)` kuralları **kaldırıldı** ✓ → sekmeler düz XP gradyanına döndü ✓; test artık
   **renk yokluğunu** doğruluyor ✓.

## Tarama (8 ajan + çürütücüler) — **kritik yakalama**
En kritik bulgu **benim 1.9.92'deki `ensureSections` hatamdı** ✗: bölümsüz bir üst klasörün **alt klasörü** otomasyon
içeriyorsa üst `'canvas'` oluyor ve **çocuk + içeriği hiçbir sekmede görünmüyordu** (gerçek yetim ✗). **Senin canlı
kütüphanen düz olduğu için** (tek klasör `Güncel Tuvaller`, `section` NULL, 9 tuval ✓; 1 otomasyon klasörsüz ✓)
**1.9.92'de zarar oluşmadı** ✓ — bu sürümde hata **kapatıldı** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 102 dosya** ✓ (renksizlik ✓, bölümlü fixture'lar ✓, yeni ad kuralı ✓) ·
**beş npm paketi** ✓ · **sekiz Node regresyon** ✓ · **PS 5.1'de 10 harness** ✓ · `pack:win` ✓ ·
**masaüstü kopyası hash ile doğrulandı** ✓ · **ASAR'ın içinden** izler ölçüldü ✓.

## Doğrulanmayan / bu sürüme **alınmayan**
**Klavye erişimi** (ağaçta ok tuşları ✗, menü odağı ✗, roving tabindex ✗) · **tablet görünümü (`ViewerApp`) hâlâ eski
Kütüphane/Arşiv araç çubuğunu kullanıyor** ✗ (masaüstü ile ayrışıyor ✓) · **ağ paylaşımında PID denetimi** ✗ ·
**PID geri dönüşümüyle kalıcı kilit** ✗ · canlı **iki örnek/çakışma** senaryosu ✗ denenmedi.