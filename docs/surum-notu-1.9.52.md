# Sürüm notu — 1.9.52 (Nubbo_Combined_OCR_Condition)

Kaynak: kullanıcının `Nubbo_Combined_OCR_Condition_Fix` paketi (taban `7dbb4e1` = v1.9.51).
Ters kontrol başarısız (henüz uygulanmamış) → düz kontrol başarılı → **zorlamadan** uygulandı ✓;
`git diff --check` temiz ✓; **19 dosya** ✓.

## 1) Birleşik OCR (Windows + ONNX aynı karede)
- Normal OCR taramaları — **Tıkla**, **Yazı Yaz'ın hedef araması**, **metin listeli İnisiyatif**, **Ekran
  Tarayıcı** ve **CLI `screen.read`** — artık **aynı merkezi taramayı** kullanır: **Windows OCR + ONNX
  birlikte**, **tek yakalanmış kare** üzerinde ✓. Yalnız resim isteyen `ocr:false` yolları OCR başlatmaz ✓.
- **Önizleme** OCR kopyasından **ayrı** kalır ✓ (gri/boş önizleme sorunu bu ayrımla korunur ✓).
- Aynı yerde aynı okuma **tek kayıt** olur ve kaynağı **Windows+ONNX** der ✓; **farklı** okuma (ör. Latin
  vs Çince) **silinmez** ✓; başka yerde aynı yazı **ayrı hedef** kalır ✓.
- **Windows'un gerçek kelime kutuları korunur** ✓; ONNX yalnız **satır** ölçtüyse **sahte kelime konumu
  türetilmez** ✗. Çok kelimeli ONNX satırı: Tıkla listesinde **bağlam**, Koşul için **seçilebilir kanıt** ✓;
  Tıkla yine gerçek kelime/tek token veya mevcut görsel hedeflemeyi kullanır ✓.
- Tanıma eşikleri, model dosyaları, Windows OCR ölçeklemesi ve ton işlemesi **değiştirilmedi** ✓.

## 2) Koşul (salt okunur)
| Koşul metni | Yol |
| --- | --- |
| `"Bitti"` (tamamı tırnaklı) | **Yerel** birleşik OCR — API gerekmez |
| `Bitti` (tırnaksız) | **LLM yorumu** |
| `job finished 60/60 yazıyorsa evet ver` | **Tam tarif LLM'e**; sayı ve olumsuzluk korunur |
| `"job finished" ve 60/60 görünüyorsa evet` | **LLM**; alıntı sayacı silinmez |
| Boş metin + seçilmiş hedef | **Salt okunur** öğe/resim araması |

- Koşul **tıklama, hover, tuş, yazma, popup kapatma göndermez** ✗; odak değiştirmez ✗; var/yok ve mevcut
  bekleme/zaman aşımı bağlantıları korunur ✓.
- **API/yakalama/Stop hatası "yok" diye gizlenmez** ✓; ONNX kullanılamazsa **Windows verisi korunur** ✓.
- **Davranış değişikliği (bilinçli)**: önceden **yerel** aranan **tırnaksız** koşul metni artık **tarif**
  sayılır ve **API gerektirir** ✓. Yerel mi tarif mi olacağını kullanıcı **tırnakla** seçer ✓; **eski
  akışlar topluca dönüştürülmedi** ✓.

## 3) Değişmeyenler
Yeni her-adım başarı kontrolü **yok** ✗; İnisiyatif'in *hareket → tıklama*, doğrudan yazma ve kısayol
yürütme yolları **korundu** ✓; eski node değerleri dönüştürülmedi ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest: paketin 335 geçen testi burada 5 atlama olmadan koştu** ✓ (toplam dosya/test sayısı çıktıda ✓)
- **Derlenmiş motor Node paketleri: 116 pass / 0 fail** ✓ (paketin bildirdiği 116 ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness** ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Gerçek Windows OCR, canlı ONNX çıkarımı, gerçek LLM kararı ve paketlemenin canlı kullanımı bu
  ortamda denenmedi** ✗; **tanıma başarımı için yüzde garantisi yok** ✗.
- **İki okuyucuyu her taramada çalıştırmak gecikme ve jeton kullanımını artırabilir** ✓ — **bu makinede
  ölçülmedi** ✗ (uzun koşuda gözlem gerekiyor ✓).
- Canlı kabul: (1) Ekran Tarayıcı'da **iki okuyucunun** okumaları/kaynakları ve önizleme düzgünlüğü ✓;
  (2) mevcut Tıkla hedefi **gerçek kelime kutusunu** kullanmalı ✓; (3) Koşul'a `"Bitti"` → görünürken
  var ✓, yokken yok ✓ ve **mouse hareket etmemeli** ✗; (4) `job finished 60/60 yazıyorsa evet ver` için
  **60/60** ve **6/60** ekranlarını ayrı ayrı dene ✓, modelin gerekçesini logdan oku ✓; (5) Koşul hedefi
  görmek için **popup kapatmamalı/menü açmamalı** ✗; (6) mevcut *Fareyi Oynat → İnisiyatif tıklaması* ve
  Yazı Yaz akışı çalışmalı ✓.