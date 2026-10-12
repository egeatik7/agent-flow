# Sürüm notu — 1.9.110 (hedef listesinde tek numara dünyası + reddin gerçek sebebi)

**Kaynak**: kullanıcının 1.9.109 günlüğü (`logs\1.9.109\calistirma-2026-10-12T19-33-28.txt`) üzerine yapılan
inceleme. Kullanıcının şüphesi ("öğe numaraları karışıyor") **doğrulandı**.

## Günlükten ölçülen tablo

| Model | Döndürdüğü numara | Sonuç |
| --- | --- | --- |
| Qwen (yazı) | **214** ("5.2") | ✅ kabul, tıklandı |
| Qwen (yazı) | **348** ("Anvil.glb") | ✅ kabul, tıklandı |
| Qwen (yazı) | **179 / 143 / 141** ("User Perspective") | ❌ "LLM uygun öğe bulamadı" |
| Qwen (yazı) | **36** (adres kutusu, iki kez) | ❌ "LLM uygun öğe bulamadı" |
| GLM (görsel) | ayrı çağrıda ekran görüntüsü | ✅ kabul, tıklandı |

Aynı numara farklı isteklerde **farklı öğeyi** gösteriyor (ör. `#214` bir listede "Mode", başka listede
"Shading"): numaralar **tarama başına** üretiliyor.

## Kök neden: listede İKİ numara dünyası vardı

- **Satır başındaki `#N`** = seçilebilir aday numarası (kelime adayları `nextId++` ile **yeni** numara alır).
- **`parent=#13`, `overlapping-OCR=#124(100%)`** = **asıl öğe kimlikleri** (küçük numaralar) — başka bir
  numara dünyası ve çoğu **seçilebilir aday bile değil**.

Küçük yerel model bu iki dünyayı karıştırıp listede olmayan / tıklanabilir olmayan numara döndürüyor;
program da sebebini söylemeden reddediyordu.

## Düzeltmeler

1. **Tek numara dünyası (`word-targets.ts`)**: referanslar artık numara taşımaz —
   `OCR-word parent-line="Run Remesh"` (üst satırın **metni**) ve `overlapping-OCR=100%` (yalnız yüzde).
   Böylece listede karıştırılacak ikinci bir numara kalmaz.
2. **Reddin gerçek sebebi (`openrouter.ts` + `agent.ts`)**: karar nesnesi `rejected`
   (`absent` = bu listede yok, `not-selectable` = var ama tıklanabilir değil, `not-listed` = aday sınırı)
   ve `rawId` (modelin ham numarası) taşır; günlük artık
   *"LLM uygun öğe bulamadı (#179 bu listede yok)"* gibi **dürüst** yazar.
3. **Modelin verdiği METİNLE kurtarma (`agent.ts`)**: numara çözülemezse ama model bir metin verdiyse
   (ör. "User Perspective"), o metin deterministik eşleştirmeyle aranır; bulunursa **görsel modele gitmeden**
   tıklanır ve bu durum günlüğe yazılır. Bulunamazsa davranış eskisi gibi (sonraki aşama).
4. **Yanıltıcı "OCR'da yok" mesajı**: doğrudan eşleşme başarısız olduğunda artık
   *"… doğrudan bulunamadı"* + varsa **Sebep: eşit puanlı adaylar…** satırı yazılır.

## Doğrulama

- Yeni `tests/fix-tur9-rejected-id.test.ts` **4/4** ✓: listede olmayan numara → `rejected='absent'`,
  `rawId` korunur, modelin metni korunur · kelime geometrisi olmayan çok kelimeli OCR adayı →
  `rejected='not-selectable'` · geçerli OCR kelime numarası **eskisi gibi** çözülür (regresyon yok) ·
  listede `parent=#`/`overlapping-OCR=#` **kalmadı**, `parent-line="Run Remesh"` var.
- `typecheck` ✓ · **Vitest 108 dosya / 821 geçti / 0 kırmızı** ✓ (kalan tek kırmızı, paketin kendi
  `zip-library-storage` testinin **bilinen kararsızlığı**: tek başına 26/26, tam koşuda ara sıra düşüyor —
  1.9.107 notunda da yazılı) · **beş Node paketi + `test:lock`** hepsi 0 kırmızı · **on iki PS harness** exit 0.

## Sınırlar (dürüst)

- **Görsel model (GLM) yolu değişmedi**: yazı modeli hedefi bulamazsa ekran görüntüsü hâlâ ayrı çağrıda
  görsel modele gider — bu tasarım korundu (kullanıcının "Qwen'e screenshot gitmiyor" gözlemi doğru;
  o görüntü **görsel modele** gidiyor ve o da doğru yeri buldu).
- Kurtarma yolu **ajan düzeyinde otomatik test edilmedi** (kanıt: sebep/numara testleri + kod incelemesi);
  canlı Blender koşusunda tekrar denenmeli.
- Yerel modelin yanlış *gerekçe* üretmesi (ör. "sol altta" derken sol üstte olması) **modelin kendi
  hatasıdır**; program artık onun numarasına körü körüne uymuyor, metni doğruluyor.
