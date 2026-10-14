# Sürüm notu — 1.9.140

**Taban:** `0bfc324` (1.9.139).

## Ne değişti

- Hedef ilk aramada yoksa ekran yenilenir ve aynı hedef bir kez daha aranır. İkinci denemede de yoksa Kurtarma Ajanı açıksa o devreye girer; kapalıysa akış durur. Düğümün hedef metni başka bir metinle değiştirilmez.
- Yap bütçesi yalnız gerçek eylemleri sayar. Ekran okuma ve bitirme hakkı düşürmez. Eylem aracından önce eski ekran gözlemi silinir.
- Koşu başında ayarlar dondurulur. Koşu bitince yeni kayıtlar yine anında geçerli olur.
- Kayıtlı konum, diğer yöntemler bulamazsa son çare olarak tıklanır.
- Tek adım ve eylem testleri kendi süre ve durdurma işaretini model çağrısına da iletir. Model denemesinin HTTP süresi kalan 15 dakikayı aşamaz.
- İşletim sistemine girdi gittikten sonra çıkan hata, aynı düğüme ikinci kez tıklatmaz. Yaz düğümü görsel hedefi imleç onayından geçirir. Bozuk model çıktısı “ekranda bulunamadı” diye yazılmaz.
- Her adım HUD aşama şeridini sıfırlar. Düğüm kopyası derin kopyadır.
