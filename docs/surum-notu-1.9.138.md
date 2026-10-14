# Sürüm notu — 1.9.138

**Taban:** `ed503c7` (1.9.137). Kaynak: `nubbo-gorsel-computer-use-format.patch`.

GUI-Owl görsel hedeflemesi `computer_use` araç çağrısını doğrudan kullanır.

## Ne değişti

- Hedef `mouse_move` ve 0–1000 koordinat çiftiyle gelir. Nubbo fareyi kendi motoruyla taşır.
- Hedef yoksa `terminate/failure` gelir. Bu, bütün akışın bittiği anlamına gelmez.
- Doğrudan tıklama, tuş, yazma ve scroll bu aşamada reddedilir. Koordinat uydurulmaz.
- Görsel hedefleme isteğinden `response_format: json_object` kalktı. Diğer çağrılar aynı kaldı.
- UI-TARS native cevabı ve popup akışı duruyor. GUI-Owl hedeflemesinde otomatik popup kapatma yok.
