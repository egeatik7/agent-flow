# Sürüm notu — 1.9.51 (Nubbo_Popup_Target_Fix)

Kaynak: kullanıcının `Nubbo_Popup_Target_Fix` paketi (taban `b702bb9` = v1.9.50).
Ters kontrol başarısız (henüz uygulanmamış) → düz kontrol başarılı → **zorlamadan** uygulandı ✓;
`git diff --check` temiz ✓; **7 dosya** ✓.

## Değişen davranış (paketin metni)
Görsel hedef bulucu artık genel görev yürütücüsünün `guiStep` cevabını **hedef koordinatı olarak
kullanmıyor**; ayrı `chooseVisualTarget` çağrısı üç sonuçtan birini ister:
- **`target`** — node'un istediği asıl kontrolün noktası.
- **`dismiss`** — asıl kontrolü örten **ilgisiz popup'ın** açıkça seçilebilir X/Kapat/İptal düğmesi (ara işlem).
- **`missing`** — hedef yok ya da engeli ana uygulamadan güvenle ayıramıyor.

Gerçek **Tıkla** node'unda **en fazla bir** popup kapatma girdisi gönderilir ✓; ardından **aynı node içinde
yeni ekran** alınır ve orijinal hedef + gerçek kapatma kaydı modele verilir ✓. **Asıl hedefin noktası
bulunmadan node başarılı dönmez** ✓. Kapatma koordinatı **hedef hafızasına veya kırpma merkezine
geçirilmez** ✓. Popup girdisi başarısız ya da **kısmen gönderilmiş olabilecekse yeniden denenmez** ✓;
sonraki hedef araması da başarısızsa genel yenileme yolu kapatmayı **tekrar çalıştırmaz** ✓.

Önizleme, **offline replay**, **Fareyi Oynat** modu ve **Yaz node'unun kendi hedef araması** popup
kapatmaz ✓ (asıl hedef görünüyorsa normal hedefi kullanır ✓; kullanıcı açıkça popup kapatmayı istemişse
kapatma düğmesi zaten asıl hedeftir ✓). **Model ayarlarının sırası değiştirilmez** ✓. Bu bir tamamlanma
yargıcı **değildir** ✗ — hedefin yeni karede seçilmesidir ✓. Model eski biçimde etiketsiz bir click
döndürürse o belirsiz yanıt **gönderilmez**; yedek model zinciri yeni sözleşmeye uygun cevabı dener ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest: 314+ test geçti, 0 atlandı** ✓ (paketin 5 atladığı test burada çalıştı ✓)
- **Derlenmiş motor Node paketleri: 114+ pass / 0 fail** ✓ (paketin bildirdiği 114 ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓ (bu paket worker/köprü/OCR/yazma koduna dokunmadı ✓)
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Canlı Windows masaüstü, gerçek popup kapatma, canlı UI-TARS/Luna/DeepSeek istekleri, gerçek alan
  odağı/yazma ve Windows EXE paketlemesi bu ortamda denenmedi** ✗ (paketin de yazdığı sınır ✓);
  geçen testler **sözleşmeyi ve gönderim sırasını** kanıtlar ✓, **görsel modelin doğruluğunu kanıtlamaz** ✗.
- Canlı sınama ✓: (1) engelsiz kutu → tek hedefleme ✓; (2) alanın üstünde ilgisiz popup → **kapat** →
  yeni kareden gerçek alan → sonra yaz ✓ (kapatmadan **sonra doğrudan Yaz'a geçilmemeli** ✗);
  (3) kapatma sonrası alan yoksa **aynı kapatma tekrar gönderilmemeli** ✓, node hata vermeli ✓;
  (4) **Fareyi Oynat**/önizleme popup üzerinde tıklama üretmemeli ✓; (5) tek/çift/sağ tık modları ve
  İnisiyatif'in *fareyi oynat → yeni kare → modelin kendi tıklaması* davranışı korunmalı ✓;
  (6) popup yanıtı ile ikinci arama arasında **Durdur**'a basılırsa ilave girdi gitmemeli ✓.