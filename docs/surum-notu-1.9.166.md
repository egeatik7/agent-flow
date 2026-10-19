# Sürüm notu — 1.9.166 (rapor dürüstlüğü, merge hedefi, kurtarma taslakları, güvenlik sınırları)

**Taban:** `75479e8` (1.9.165). Node türleri/şemaları değişmedi.

## Ne değişti

1. **Merge hedefi tıklama anında sabitleniyor** (`App.tsx`): AI kopyası/ZIP beklemelerinden sonra
   sekme değişmişse hiçbir şey yazılmaz; merge sürerken tuval işlemleri kilitli (`libraryBusy`).
   Yanlış tuvale yazma ve "hiçbir şey yazılmadı" yalanı bitti (ZIP kaydı başarısızsa `ambiguous`).
2. **`act.*` Durdur semantiği** (`tools.ts`): kullanıcı Durdur'a bastığında sonuç artık
   "eylem-belirsiz" değil; girdi gönderilmişse `eylem-belirsiz + sent:true` ("tekrar gönderme"),
   gönderilmemişse `durduruldu + sent:false`. Ajan aynı tıklamayı körlemesine yinelemez.
3. **`target.preview` eski durdurma bayrağına takılmıyor** (`tools.ts`): önizleme başlamadan
   `clearStop()` (tek adımla aynı kural); "aradım, bulamadım: durduruldu" yanlış cevabı bitti.
4. **Paket içi hata iki kez sayılmıyor** (`runner.ts`): sarmalama `runnerSaydi`/`haltLoop`/
   `serviceFailure` işaretlerini koruyor; `failed=2` raporu bitti. Koşul kurtarmasına `vars`
   aktarılıyor (kurtarma `{{sıra}}` görebiliyor).
5. **Kurtarma taslakları sınırsız birikmiyor** (`canvas-session.ts`): aynı tuval (savedId/ad)
   tek kayıt; en yeni 20 taslak tutulur.
6. **Viewer'a Origin denetimi** (`viewer-server.ts`): yalnız `127.0.0.1`/`localhost` Origin'i
   bağlanır; başka bir site 12 yuvayı tutup tablet izleyicisini kapıdan çeviremez.
7. **HUD "hep üstte" sayacı temizleniyor** (`main.ts`): `destroyHud` interval'i kapatıyor; süreç
   sonuna kadar dönen sayaç bitti.
8. **Hafıza `win` alanı gerçek pencere adını taşıyor** (`agent.ts`): yöntem adı (`uia`/`chrome`)
   yerine `scan.window`; yöntem değişen turda sahte "pencere değişti" + gereksiz model çağrısı bitti.
9. **ZIP bağlantı/silme de yeniden deniyor** (`zip-library-storage.ts`): arşivle/yeniden adlandır
   `link/unlink` ve silme, EPERM/EBUSY/EACCES'ta sınırlı retry (rollback dahil).
10. **Korumalı kökteki silinmiş kütüphane yolu** (`library-path.ts`): kayıtlı yol korumalı bir
    kökte ve artık yoksa korumasız profile düşülüyor (Windows Denetimli klasör erişiminde açılış
    donması yok). Test eklendi.
11. **`dev-start-test.cjs` çalışan örneğin klasörünü silmiyor**: ürünle aynı işaret dosyası kuralı.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **195 dosya / 1486 test** yeşil.
  Bilinen flaky: `tests/zip-library-storage.test.ts` (Windows `rename` EPERM; kullanıcı kararıyla
  kapatılmış F2; tek başına 27/27 geçti, tam pakette 1 kırmızı görüldü).
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- Canlı masaüstü koşusu yapılmadı; merge/act/preview yolları kod + tip denetimi ve mevcut Node
  paketleriyle sınandı, yeni UI testi eklenmedi.
- Kalan orta/düşükler: `tool-state` çift sayaç, tek eylem sonrası minimize, `graph-ops` Bitir araya
  ekleme, SidePanel Yap süre alanı, doğrulanmamış memo (yazı yolu), 400'lük aday kırpması günlüğü,
  `checkpoint` bayat devam işareti, `screen.ps1` imleç doğrulaması ve simge dx/dy telafisi.
