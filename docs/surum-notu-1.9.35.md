# Sürüm notu — 1.9.35

**İnceleme düzeltmesi: "önce oynat → konumunu gör → emin olunca tıkla" sistemi tamamlandı.**

Kullanıcı 1.9.33'ü inceledi ve altı eksik bildirdi; **altısı da kodda doğrulandı ve düzeltildi**.

## 1. Luna'nın JSON yolu (en kritik)
`parseJsonAction` (koordinatlı JSON yolu) `move`, `click_current`, `clickCurrent` eylemlerini
**tanımıyordu** ve `wait`'e düşürüyordu. Artık tanınıyor ve adlar normalize ediliyor; `move` için de
koordinat zorunlu. `SCREEN_PROMPT` hem eylem listesinde hem açıklamada bu iki komutu öğretiyor
(`move` yalnız imleci taşır; ekranda **kırmızı artı** görünür; emin olunca `click_current`).
`parseJsonAction` test edilebilmesi için dışa açıldı.

## 2. "Oradan tıkla" artık GERÇEK imlece bakıyor
Eskiden bellekteki `lastHoverPoint`'e basıyordu. Artık worker'dan **gerçek imleç konumu** okunuyor
(`cursorPos`) ve karar **saf bir fonksiyonla** veriliyor (`electron/hover.ts · hoverDecision`):
imleç kayıttan **3 px'den fazla** sapmışsa, kayıt **2 dakikadan eski**yse veya imleç okunamıyorsa
**TIKLANMAZ** ve nedeni günlüğe yazılır. Kayıt koşu başında ve fareyi taşımayan her eylemde
temizlenir.

## 3. Tıkla node'unun "Fareyi Oynat" modu kaydı güncelliyor
Node fareyi taşıyordu ama hover kaydını **yazmıyordu**; "Fareyi Oynat node'u → İnisiyatif'te
click_current" zinciri bu yüzden çalışmıyordu. Artık ikisi de **aynı kaydı** (tek modül) kullanıyor.

## 4. Model imleci görüyor
Modelin gördüğü kareye (**yalnız o yola**; OCR'ın ham yakalama yolu değişmedi) imleç konumuna
kırmızı artı + halka çiziliyor. Hover bir menü açmasa da model nerede olduğunu görebilir.

## 5. Pencere koruması artık bu çağrılarda da etkin
Taşıma anında noktanın altındaki pencere (**hwnd**) kaydediliyor; tıklama anında worker
**kendi içinde** karşılaştırıyor: pencere değiştiyse ya da nokta başka pencereyle örtüldüyse
`INPUT_CLICK_STALE` / `INPUT_CLICK_OCCLUDED` ile **tıklamıyor**.

## 6. Testler artık gerçek yolu sınıyor
Yeni `tests/hover-click-path.test.ts` (13 test) **gerçek fonksiyonları** çalıştırır: kullanıcının
ölçtüğü tablo (`move`, `click_current`, `clickCurrent`, koordinatlı click) ve karar mantığı
(kayıt yok / imleç saptı / okunamadı / kayıt bayat / hwnd taşınıyor / temizleme).

## Dürüst sınır
- **Kimlik listesiyle çalışan yol** (id veren JSON ajanı) için `move` **eklenmedi**: o yolun
  yürütme kodu ayrı ve yarım özellik bırakmamak için öğretilmiyor.
- **Canlı Windows denenmedi**: gerçek fare hareketi, karede imleç işareti, gerçek bir uygulamada
  "önce oynat → oradan tıkla" zinciri ve pencere değişimi senaryosu **ölçülmedi**. Testler gerçek
  fonksiyonları çalıştırır ama gerçek masaüstü kanıtı değildir.
- Bu çalışma **motor dosyalarına** dokunur (worker, agent, bridge, screen); kullanıcının açık isteği
  üzerine yapıldı.