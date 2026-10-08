# Tuvaller ve Otomasyonlar — tek depo

Sağdaki **Node / LLM / Ayarlar / Ajan / Tuvaller** sekmelerinden **Tuvaller**’e geç. Ayrı bir sabit kutu yoktur. Bu sekmede iki ekran vardır: **Tuval Deposu** ve **Otomasyonlar**.

## Tuval Deposu

**Tuvali Kaydet**, aktif üst sekmenin çalışma kopyasını depoya kaydeder. Kayda bağlı bir sekmede tekrar kaydetmek aynı kaydı günceller. Aynı adı taşıyan farklı kayıtlar birbirini ezmez. **Dosya → İçe Aktar** ile tek tuval JSON’u da eklenebilir; mevcut sekme ezilmez.

Her kaydın yanında:

- **+**: Yeni üst sekmede aç. Açılan sekme aynı depo kaydına bağlıdır; düzenlemeleri kayda aktarmak için **Tuvali Kaydet** kullan.
- **Kapat**: Açık çalışma sekmesini kapat; depo kaydı kalır. Birden çok açıksa aktif olan, o aktif değilse son açılan kopya kapatılır. Son üst sekme kapatılamaz. Kaydedilmeyen içerik değişikliğinde uyarı gelir.
- **✎**: Depodaki adı değiştir. Aynı kaydın adı bütün otomasyonlarda ve bağlı açık sekmelerde değişir.
- **Kırmızı ×**: Onayla kaydı depodan sil. Bu kaydı kullanan otomasyonların listelerinden de çıkarılır. Açık çalışma kopyaları kaybolmaz; kayıt bağlantıları kaldırılır. Daha sonra Tuvali Kaydet ile yeni kayıt olarak saklanabilirler.

Üst sekmedeki **×** yalnız çalışma sekmesini kapatır. Depoyu silmez. Üst sekmeye çift tıklayıp adını değiştirdiğinde yeni adı depoya aktarmak için Tuvali Kaydet kullan. **Dosya → Dışa Aktar** aktif çalışma kopyasının JSON’unu indirir.

## Otomasyonlar

Bir otomasyon ayrı tuval kopyaları saklamaz. Depodaki kayıtların **sıralı listesidir**. Bu yüzden aynı tuval birden çok otomasyonda kullanılabilir; depoda kaydedilen içerik ve ad değişikliği hepsinde geçerlidir.

1. **Otomasyonlar → + Yeni** ile boş düzenleyici aç. Adını yaz.
2. **Depodan tuval seç → Ekle** ile kayıtları ekle. Listede zaten bulunan kayıt ekleme seçeneklerinden çıkarılır.
3. **↑ / ↓** ile sırala; kırmızı **×** ile yalnız bu otomasyon listesinden çıkar. Depodaki kayıt ve başka otomasyonlar korunur.
4. **Kaydet** ile adı, üyeleri ve sıralamayı sakla. Bu aşamaya kadar değişiklikler taslaktır; kayıtlı otomasyon değiştirilmez.
5. Kayıtlı otomasyonun **Aç** düğmesi bu listeyi üstte soldan sağa açar. Açık çalışma sekmelerini değiştireceği için onay ister.

Var olan bir otomasyon için **Düzenle** kullan. Listeye daha önce dahil olmayan kayıtlı tuvalleri aynı seçim alanından ekleyebilirsin. **Kaydet** açık üst sekmelerden yeni bir liste tahmin etmez; düzenlediğin listeyi kaydeder. Liste değişikliğinden sonra üst çalışma sekmelerini yeni sıraya geçirmek için **Aç** kullan.

**Vazgeç** kayıtlı listeye döner ve kaydedilmeyen değişiklikler varsa onay ister. Başka bir otomasyona geçerken de taslağı bırakmak için onay istenir. Tuval Deposu ekranına veya Node/LLM/Ayarlar/Ajan sekmelerine geçmek taslağı silmez. Uygulama kapatılırsa kaydedilmemiş otomasyon taslağı saklanmaz.

Kayıtlı listeden farklı bir taslak açıkken o otomasyonun Aç/Export düğmeleri pasiftir; önce Kaydet veya Vazgeç. Tuvalin **node içeriğini** değiştirdiğinde de önce Tuvali Kaydet kullan: otomasyonun Kaydet düğmesi üyeleri/sırayı kaydeder, çalışma kopyalarının içeriklerini otomatik kaydetmez.

Otomasyonun kırmızı **×** düğmesi yalnız grubu siler; tuval deposunu veya açık sekmeleri silmez. Boş otomasyon kaydedilebilir; çalıştırmak üzere açılmaz.

## Export / import

**Export**, kayıtlı sırayı ve kullandığı depo tuvalleriyle birlikte taşınabilir JSON üretir. **Dosya → İçe Aktar** bu dosyayı gruplara ve depoya ekler; mevcut çalışma sekmelerini değiştirmez. Aynı ad/içeriğe sahip depo kayıtları yeniden kullanılabilir; farklı içerik var olan kaydın üzerine yazılmaz.

Eski v1 otomasyon JSON’ları da içe aktarılır. Yeni export biçimi v2’dir: içerikler tek listede, sıra ise kayıtlara referansla tutulur. Eski EXE’ye dönerek aynı profil verisini kaydetme; eski sürüm bu yeni biçimi anlamayabilir. Önce profil yedeğini al.

## Eski kayıtların taşınması

Önceki patch otomasyonların içinde ayrı tuval kopyaları tutuyordu. İlk yüklemede bunlar depoya taşınır ve gruplar depo kayıtlarına bağlanır. Aynı ad/içerikteki kopyalar aynı kaydı kullanır. Bir eski kopyanın içeriği depodakinden farklıysa **veri kaybolmaması için ayrı bir depo kaydı** oluşturulur; ada bakılarak biri diğerinin üzerine yazılmaz. İsimler aynı görünebilir; bunları depoda yeniden adlandırabilirsin. Sonraki yüklemelerde yeniden kopya üretilmez.

Depoda silinen tuval otomasyon açılırken yeniden oluşturulmaz. Kayıtlar ortak bir kaynakta tutulur. Liste üzerinde çalışırken kayıt başka bir yoldan değişmiş/silinmişse eski taslak onu ezmez; Düzenle ile yeniden yüklemen istenir.

## Sırayla oynatma

Üstte en soldaki **▶ / ■** önceki patch’teki gibi çalışır. Açık üst sekmeler soldan sağa, her biri Başlangıç node’undan yürür. Önceki tuval kendi Bitti node’una hatasız ulaşmadan sonraki başlamaz. Durdur veya hata kalan sırayı başlatmaz. Sekme sırası ile otomasyonun kayıtlı sırası ayrı çalışma durumlarıdır; otomasyonun sırasını üstte açmak için Aç kullan.

Bu düzeltme OCR, tıklama, yazma, inisiyatif ve koşu motorunu değiştirmez. Masaüstü eylemlerine yeni kontrol eklemez.
