# Sürüm notu — 1.9.49 (Nubbo_Initiative_Scope_Fix)

Kaynak: kullanıcının `Nubbo_Initiative_Scope_Fix` paketi (taban `09f0624` = v1.9.48).
`git apply --reverse --check` başarısız (henüz uygulanmamış) → `git apply --check` başarılı → **zorlamadan**
uygulandı ✓; `git diff --check` temiz ✓; **5 dosya** ✓. Bu paket önceki Direct Actions düzeltmesinin
**üstüne** gelir, yerine geçmez ✓.

## Değişen davranış (paketin metni)
1. "Diğer pencereleri açık bırak / ayarları değiştirme" gibi ifadeler **eylem kısıtı**dır; ek denetleme işi
   değildir (kullanıcı gerçekten denetim isterse o ayrı bir görevdir).
2. İnisiyatif'in **mevcut görevi her model çağrısında** geçmişten sonra, **son görüntünün/listenin yanında**
   tekrar verilir (`CURRENT NODE — ONLY ACTIVE TASK`). Görev bittiyse model **aynı yanıtta** `finished`
   seçer; ikinci değerlendirme çağrısı yoktur.
3. Modelin **önceki Thought metinleri plan olarak taşınmaz** (ham yanıt/düşünceler yalnız debug logunda).
4. **Gönderilen eylem** ayrı kaydedilir: ilk tıklama önerisi yalnız `move` olarak yürütüldüyse geçmişe
   **gerçek hareket** yazılır; ham tıklama önerisi "tıklama gönderildi" diye sunulmaz.
5. Hata veren girişim **`unconfirmed`** olarak taşınır (kısmi girdi ihtimali açık kalır); sonuç doğrulanmış
   gibi raporlanmaz. Tarihî koordinatlar kendi karesinin kesirleridir.
6. Liste İnisiyatif'ine sonraki workflow node'u görev olarak verilmez; **mevcut node'un hedefi sınırdır**.

Eklenmeyenler (paketin açık yasağı): yeni eylem veto mekanizması, otomatik `finished` kestirmesi, model
düşüncesini regex ile "başarı" sayan kod, ikinci LLM yargıcı, ekstra Koşul node'u. Hareket → yeni kare →
modelin kendi tek/çift/sağ tıklaması **korunur**. Yazma, OCR, Windows worker, normal Tıkla node'u,
runner/döngü politikası, akış şeması, kayıtlı özel promptlar ve CLI güvenliği **değişmedi**.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest 45 dosya: 294 test geçti, 0 atlandı** ✓ (paketin 5 atladığı test burada **çalıştı** ✓)
- **Derlenmiş motor Node paketleri: 93 pass / 0 fail** ✓ (paketin bildirdiği 93 ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓ (bu paket .ps1'e dokunmadı ✓; yine de regresyon için koşuldu ✓)
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Gerçek UI-TARS / Luna / DeepSeek kararı bu makinede denenmedi** ✗ (paketin de açıkça yazdığı sınır ✓);
  sahte API yanıtıyla geçen test, gerçek modelin artık hiç sapmayacağını **kanıtlamaz** ✗.
- **Canlı profil turu yapılmadı** ✗ — beklenen zincir: hedefe yalnız hareket → modelin tıklaması → profil
  açılması → `finished`. "Diğerlerini açık bırak" nedeniyle menü/ayar/hesap denetimine sapmamalı.
- Logda görülmesi gerekenler: geçmişte `Executor record … "kind":"move"` + sonrasında gerçek click ✓ ve son
  görüntünün yanında **CURRENT NODE — ONLY ACTIVE TASK** bölümü ✓.
- Ana model hâlâ **UI-TARS 1.5 7B**; sıralama bu patch içinde **değiştirilmedi** ✓ (kullanıcı isterse ayrıca
  değiştirip karşılaştırabilir ✓).