# Sürüm notu — 1.9.133

**Taban:** `472fcc2` (1.9.132). Bug taraması dalı `main` ile birleştirildi.

1.9.132’nin bellek ölçümü (Toolhelp ebeveyn PID, `llama-server` toplamı) duruyor. O dosyadaki ikinci yama onun üzerine yazılmadı. Node türleri ve akış sözleşmesi duruyor.

## Ne değişti

- “İndir” aynı satırdaki “İndirim”e, “Kaydet” “Kaydetme”ye gitmez. “Opera'ya” gibi kısa ek durur.
- Paketin kayıtlı çıkışı, çıkış node'u bir Her Öğe İçin kutusunun içindeyse de sayılır. Çıkışa varılmazsa koşu eksik yazılır.
- Görsel tıklama imleç kaydı veya örtülü nokta yüzünden kesilmez. Kendi penceresi ve bozuk tuş hâlâ keser. Çift tıklama ilk basıştan sonra bölünmez.
- ANSI dışı yazı, alanı temizlemeden önce panoya sığdığı kanıtlanır (`VkKeyScanW`).
- Çoklu sürüklemede her node kendi kutusuna girer. Tel, kutu gövdesine de bağlanır. “Buradan başla” boş satırı saymaz.
- Canlı tablet önceki turun çizgisini keser. Dal koşusu tableti oynatmaz.
- “Yüklü bağlam” yalnız ölçülen yüklü penceredir.
- ONNX tespit modeli PP-OCRv4 tespit normalizasyonunu kullanır.
- Araç planı döngü üyeliğini kutunun dışına taşımaz. Hızlı bakış, kapatılmış aşamayı geri açmaz. Olmayan paket yolu kök grafa düşmez.
- Başlangıç'sız yükleme döngü üyesine değil kutuya bağlanır. Chrome sekmesi alt dizgiyle eşleşmez.
- Damgası uymayan test başlatması hazır sayılmaz.

## Birleştirme

`docs/surum-notu-1.9.132.md` ve `electron/memory-meter.ts` iki tarafta da değişmişti. 1.9.132 notu ve Toolhelp bellek ölçümü korundu. Bug taraması 1.9.133 oldu.
