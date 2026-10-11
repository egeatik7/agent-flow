# Sürüm notu — 1.9.92 (kütüphane/klasör yöneticisi düzeltmeleri)

**Kaynak**: kullanıcının ilettiği **dış rapor** (4 iddia — dördü de satır satır doğrulandı) + **iki paralel çok-ajanlı
tarama** (**19 ajan**, **62 bulgu**, 3'ü çürütüldü).

## 1) Kayıt çakışması → ayrı durum + toparlanma yolu
`LibraryConflictError` · `isLibraryConflict` · `stale()` · `reload()`; `save()` tipli hata fırlatır. `main.ts`
`storeWorkspace` kütüphane yazımını **ayırdı** → **çakışmada bile oturum kaydı her zaman yazılır** ve çağırana
**`{conflict:true}`** döner. `App.tsx`: tek satır log + **menü → “Kütüphaneyi Yeniden Yükle”** (`library:manage 'reload'`) →
kütüphane tazelenir, **açık sekmeler ve taslaklar korunur**. Kontrol silinmedi.
`claim()`/`release()` ile oturum boyu **yazıcı sahipliği**; `locked()` **yalnız kendi oturum kilidimizi** (nonce eşleşmesi)
atlar — **aynı pid'li yabancı kilit yine bloklar**; `restore()` önce `reload()` eder.

## 2) Klasör bölümü (Tuval / Otomasyon)
`LibrarySection` + `LibraryFolder.section`; **SQLite `user_version=2`** + `folders.section`; decode **1 ve 2'yi** kabul eder.
`newFolder` bölüm taşır; `move` başka bölümün klasörüne taşınırsa bölüm **uyarlanır**; **bölümsüz eski klasörler iki bölümde
de görünür**. Ayrıca **aynı üstte aynı adlı klasör reddedilir**; **silinen klasörde bekleyen otomasyon taslağının klasör
bağı temizlenir**.

## 3) Menü temizliği
**Yeni Klasör** her bölümde (kendi bölümüyle) · **Yeni Tuval** yalnız Tuvaller · **Yeni Otomasyon** yalnız Otomasyonlar ·
**“Kütüphaneyi Yedekle”** ve **“Yedekten Geri Yükle…”** kaldırıldı · **“Kurtarılan çalışmalar”** paneli kaldırıldı
(o paneli sınayan **tek arayüz testi gerekçesiyle `skip`**; **taslaklar kitapta duruyor**). **Mevcut kayıtlar silinmedi.**

## 4) Tek örnek
`boot.ts`: `requestSingleInstanceLock()` + `second-instance` ile pencereyi öne getirme. Kilit **userData** yoluna bağlı →
`NUBBO_PROFILE` ile ayrı **test örnekleri etkilenmez**.

## Doğrulama
`typecheck` · `build:electron` · **Vitest 102 dosya** (yeni `tests/library-sections.test.ts`) · **beş npm paketi** ·
**sekiz Node regresyon** · **PS 5.1'de 10 harness** · `pack:win` · masaüstü kopyası hash ile doğrulandı ·
**ASAR'ın içinden** izler ölçüldü.

## Doğrulanmayan / bu sürüme alınmayan
**Tek örnek** ve **yeniden yükleme** canlı iki Nubbo örneğiyle denenmedi; çakışma durumu **yalnız günlükte** (banner yok).
**Alınmayan**: klavye erişimi (ağaçta ok tuşları, menü odağı, roving tabindex), ağ paylaşımında PID denetimi, PID geri
dönüşümüyle kalıcı kilit, ikinci Nubbo penceresinin hedef olması, `dev-start-test.cjs`'in tek-örnek sözü,
`archived:false`'ın düşmesi (zararsız), elle alınan yedeklerin rotasyona girmesi.