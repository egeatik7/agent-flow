# Sürüm notu — 1.9.101 (Koşul tek geçiş: bir kez UIA, gerekirse bir kez OCR)

**Kaynak**: `Nubbo_Kosul_Tek_Kontrol_Patch` → `Nubbo_Kosul_Tek_Kontrol.patch`
(SHA256 `4c9760c4…`). Paketin tabanı **tam bizim yayın commit'imiz `ed13c32` (1.9.100)**.

## Uygulama ve çakışma çözümü

- `git apply --check` **yalnız `electron/graph-types.ts`** dosyasında çakıştı (76 satırlık hunk'ın bağlamı
  bizim dosyamızdaki satır konumlarıyla birebir örtüşmedi; üç-yönlü birleştirme de o dosya için gerekli
  ön-görüntü blob'unu bulamadı).
- Çözüm: patch **diğer 20 dosyada zorlamadan uygulandı**, `electron/graph-types.ts` ise paketin kendi
  **referans kopyasıyla** alındı. Kanıt: paketin hedefi bizim özgü eklememizi (`stableStartId`) ve kütüphane
  paketinin tüm izlerini (`canvasId`, `legacyMembers`, `AutomationEntry`) **zaten içeriyor**; uygulama
  sonrası **21 dosyanın tamamı referansla birebir aynı** çıktı (0 fark) ✓.
- `graph-types.ts` dışındaki hiçbir dosyaya elle müdahale gerekmedi.

## Yeni Koşul sözleşmesi (paketin getirdikleri)

1. **Tek geçiş:** bir koşul adımı **bir kez UIA** okur, açık kanıt yoksa **bir kez birleşik Windows + ONNX
   OCR** okur ve kararı **metin modeli** verir. Karar `satisfied: boolean` ile gelir; kanıt ID'si yokluk
   koşullarında `null` olabilir (`id: number | null`), yani **model ID'siz de "koşul sağlandı" diyebilir**.
2. **Boş/kısmi okuma tek başına yokluk kanıtı değildir:** boş liste de modele sorulur (eskiden yerel yolla
   kısa kesilebiliyordu).
3. **Görünene kadar bekle alanı ve iç tekrar döngüsü KALDIRILDI** (eski `timeoutMs` koşulda kullanılmaz).
   Tekrar kurmak için: **Koşul → Zamanlayıcı → Koşul** deseni. Koşul model zinciri **bir kez** yürütülür;
   yedek modeller aynı zincirde birer kez denenebilir, başa dönülmez. Tıkla/Yazı Yaz tekrar davranışı
   değişmedi.
4. **Pencere alanı yalnız model bağlamıdır** (kanıtı o pencereye kilitleyen yerel bir seçim yapmaz).
5. **Eski ekran seçimi (locator/anchor) taşıyan koşullar açık uyumluluk hatası verir** — akış dosyaları
   otomatik değiştirilmez; panelden "Eski seçimi temizle" deyip koşulu cümleyle yazmak gerekir.
6. **Özel Koşul promptu** eski yalnız-`id` JSON biçimini zorluyorsa Yöntemler → Koşul'dan güncellenmeli ya
   da sıfırlanmalı (yeni biçim `satisfied` + `id`).
7. Panel/ipuçları ve `docs/CONDITION-SINGLE-PASS-PATCH.md` bu davranışa göre güncellendi; tek-geçiş notu
   kullanıcıya da yazılıyor.

## Doğrulama (bu derlemede, Windows'ta koşuldu)

- `typecheck` ✓ (üç proje) · **Vitest 116 dosya / 917 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.100 tabanı 116/911 → **+6 test**).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- 1.9.100'de eklediğimiz **masaüstü kartı düzeltmesi** korunuyor (`tests/fix-tur5-hud.test.ts` **6/6** ✓;
  patch `electron/main.ts`'e dokunmadı).
- Paket referansıyla **byte karşılaştırması: 21/21 dosya birebir** ✓.

## Sınırlar

- Paketin kendi notu: **canlı Windows testi ve gerçek LLM doğruluk testi yapılmadı**; EXE üretilmemişti
  (bu derlemede `pack:win` ile üretildi ve masaüstüne kopyalandı).
- Koşulda tekrar artık **akışla** kurulur (Koşul → Zamanlayıcı → Koşul); kullanıcı bunu kurmazsa koşul
  tek seferlik kalır — bu bilinçli bir davranış değişikliğidir.
- 1.9.98–1.9.100 notlarındaki diğer açık kalemler değişmedi (typeText'in korumalı dalı, Yap `allowCode`
  varsayılanı, ONNX hatasının görünmemesi, izin kapsamı, yerel model anahtarı, profil klasörü çakışması,
  exe damgası, tablet/canlı masaüstü testi).
