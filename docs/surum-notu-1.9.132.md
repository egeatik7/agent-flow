# Sürüm notu — 1.9.132

Bug taramasında doğrulanan hatalar. Mevcut node türleri, komutlar ve akış sözleşmesi duruyor.

- Kelime kutusu artık önekle seçilmiyor: “İndir” aynı satırdaki “İndirim”e, “Kaydet” “Kaydetme”ye gitmez. Sorgunun kısa eki (“Opera'ya” → “Opera”) durur.
- Paketin kayıtlı çıkışı, çıkış node'u bir Her Öğe İçin kutusunun içindeyse de sayılır. Çıkışa varılmazsa koşu bunu eksik diye yazar.
- Görsel tıklama, imleç kaydı veya örtülü nokta yüzünden tıklamadan vazgeçmez; kendi penceresi ve bozuk tuş hâlâ keser. Çift tıklama ilk basıştan sonra “gönderilmedi” diye bölünmez.
- ANSI dışı yazı, alanı temizlemeden önce panoya sığdığı kanıtlanır. `CanType` Unicode `VkKeyScanW` kullanır.
- Çoklu sürüklemede her node kendi durduğu kutuya girer. Yapıştırılan node, bırakıldığı kutunun üyesi olur. Tel, kutu gövdesine de bağlanır.
- “Buradan başla” işareti boş satırları saymaz; koşunun kullandığı listeyle aynı indekstir.
- Canlı tablet, sunucuyla aynı kuralda önceki turun çizgisini keser. Dal koşusu tabletin çalışan tuvalini oynatmaz.
- “Yüklü bağlam” yalnız ölçülen yüklü penceredir. Yapılandırılmış değer ve isteğin `num_ctx`'i kendi satırında kalır.
- ONNX tespit modeli tanıma formülüyle değil, PP-OCRv4 tespit normalizasyonuyla beslenir.
- Bellek kartı Windows PowerShell 5.1'de süreç ağacını `Win32_Process` ile kurar; boş toplam Blender sayacını düşürmez.
- Araç planı, döngü üyeliğini kutunun eski çıkış okuna taşımaz. Hızlı bakış kapatılmış ekran aşamasını geri açmaz. Olmayan paket yolu kök grafa düşmez. `act.wait` yazma iznine bakar. Hedef önizlemesi Durdur'u dinler.
- Başlangıç'sız yükleme, döngü üyesine değil kutunun kendisine bağlanır.
- Chrome sekmesi başlıkta alt dizgi aramaz.
