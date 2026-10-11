# Sürüm notu — 1.9.88 (XP tarzı **kütüphane yöneticisi**)

**Kaynak** ✓: kullanıcının `Nubbo_1.9.88_XP_Kutuphane` paketi ✓ (`Nubbo_XP_Kutuphanesi.patch` ✓,
SHA256 `ee6500e7…` ✓). Taban **`82113e7`** ✓ = birebir benim HEAD'im ✓. Düz `git apply --check` = **0** ✓.
Paket `package.json` + `package-lock.json`'a dokunuyor ✓ ama **tek fark sürüm satırı** ✓ (`1.9.87 → 1.9.88` ✓, **6 satır** ✓) ve
**bağımlılık değişikliği yok** ✓ → kural gereği bu iki dosya `--exclude` ile **hariç tutuldu** ✗ ve sürümü ben **aynı numaraya**
(**1.9.88** ✓) çıkardım ✓ (paketin istediği numara ✓). Paketin `KULLANIM.md`'si *“uzaktaki main değiştirilmedi, push yetkisi
yoktu”* diyor ✗ → **senin otomatik yayın kuralın** gereği **push edildi** ✓.

## Gelen
1. **Tuvaller sekmesi artık XP tarzı klasör ağacı** ✓; kullanıcı kalıcı **kütüphane klasörünü**
   **Farklı Klasöre Kaydet…** ile seçer ✓.
2. **Klasör işlemleri sağ tık menüsünde** ✓ (yeni klasör ✓, yeniden adlandırma ✓, arşivleme ✓, boş klasör silme ✓); çift tık
   veya **+ / −** ile açılıp kapanır ✓; **Ctrl/Shift** çoklu seçim ✓; **sürükle-bırak taşıma** ✓ (boş alana bırakmak ana
   klasöre taşır ✓; klasör + çocukları seçilirse **hiyerarşi korunur** ✓).
3. **Arşiv / Arşivden Geri Al** ✓ — **bağlantılar korunur** ✓.
4. **Otomasyonlar aynı ağacı kullanır** ✓; adının **altında açılan liste** ✓; **Tuval Ekle…** ile ağaçtan **çoklu** tuval
   ekleme ✓ (zaten ekli olanlar gösterilmez ✓); satırları sürükleyerek veya **sağ tık → Yukarı/Aşağı Taşı** ile sıralama ✓;
   **Listeden Çıkar** kütüphanedeki tuvali **silmez** ✓.
5. **Paylaşım** ✓: seçilen klasördeki **`nubbo-library.json`** (veya tüm klasör + **Backups** ✓) verilir ✓; alan taraf
   **Başka Kütüphane Aç…** ile açar ✓. **API anahtarları, uygulama ayarları, çalışma sekmeleri ve kurtarma taslakları
   paylaşım dosyasına GİRMEZ** ✓; node içindeki **dosya yolları ve komutlar aynen taşınır** ✓ (karşı makinede kaynaklar
   bulunmalıdır ✓).
6. **Kalıcılık** ✓: kütüphane değişiklikleri **atomik** yazılır ✓; önceki sürüm **Backups**'a alınır ✓; otomatik kayıtlarda
   **son 30 yedek** ✓; elle **Kütüphaneyi Yedekle** ✓ + **Yedekten Geri Yükle…** ✓.
7. **Dış yazıcı çakışması** ✓: başka program aynı dosyayı değiştirdiyse **eski kopya üzerine yazılmaz** ✓;
   **Yeniden Yükle** ile güncel kayıt alınır ✓.
8. **Eski kayıtlar** ✓: ilk açılışta `%APPDATA%\xp-agent-studio\Library` altına aktarılır ✓; **mevcut kimlikler korunur** ✓.
9. **Ayrıca** ✓: önceki pencereye özgü koşul düzeltmesi ✓ (`a11y/screen.ps1` + `a11y-bridge.ts`: **`strictWindow`** ✓) ve
   **README** ✓ + **`docs/tuvaller-ve-otomasyonlar.md`** ✓ güncellemeleri ✓.
   **Yeni dosyalar** ✓: `electron/library-storage.ts` ✓ · `electron/library-tree.ts` ✓ · `src/components/LibraryTree.tsx` ✓ ·
   `docs/tuvaller-ve-otomasyonlar.md` ✓ · `tests/library-storage.test.ts` ✓ · `tests/library-manager-dom.test.ts` ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest** ✓ · **beş npm paketi** ✓ (skip sayılarıyla ✓) · **sekiz Node regresyon** ✓ ·
**PS 5.1'de 10 harness** ✓ (**paket bunları koşmadı** ✗) · `pack:win` ✓ · **masaüstü kopyası hash ile doğrulandı** ✓ ·
**ASAR'ın içinden** yeni kodun izleri ölçüldü ✓.

## Doğrulanmayan (dürüst ✗ — paketin kendi doğrulaması da böyle diyor ✓)
**Canlı Windows masaüstü ve EXE açılışı** ✗ denenmedi ✓; **kütüphane klasörünü taşıma/aktarma gerçek profilde** ✗ ve
**iki makine arasında paylaşım** ✗ denenmedi ✓; sağ tık/sürükleme/otomasyon seçicisi **DOM olaylarıyla** sınandı ✓ ama
**gerçek fareyle** değil ✗.