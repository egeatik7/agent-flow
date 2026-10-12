# Sürüm notu — 1.9.102 (Ayarlar → Genel sadeleştirildi)

**Kaynak**: kullanıcının isteği (patch paketi değil).

## Kullanıcının isteği

> "ayarlarda genel kısmı var ya api key modeller falan olan, orayı iyice bi temizlemeni istiyorum, orda yazan
> tüm bilgiler gitsin, tüm öneri [tuşları] falan gitsin, sadece tuşlar ve metin kutuları kalsın, bi de işte
> OpenRouter bağlantısı, API anahtarı, metin modeli gibi başlıklar kalsın sadece. Model önerisi tuşları falan da gitsin."

## Yapılanlar (`src/components/SidePanel.tsx`, `GeneralSettings`)

**Kaldırılan bilgi metinleri (hepsi):**
- "Yerel sunucu bağlantısını Yerel Model sekmesinden kur. Bulut ve yerel modelleri aşağıdaki listelerde birlikte sıralayabilirsin."
- "İlk model önce denenir; yanıt vermezse sıradaki yedek kullanılır. ↑ ↓ ile önceliği değiştir."
- Metin modeli için "Bu model ekran görüntüsünü görebilir / göremez…" uyarısı.
- Görsel model için "Bu model ekran görüntüsü göremiyor…" ve "Görsel destekli model." uyarıları.
- Hedef pencere için "Seçilirse sadece o pencere okunur…" açıklaması ve "«X» şu an açık değil…" uyarı metni.

**Kaldırılan öneri tuşları (hepsi):**
- Görsel model **öneri çipleri** (`VISION_PRESETS`) ve Yap modeli **öneri çipleri** (`AGENT_PRESETS`) ile
  birlikte artık kullanılmayan bu sabit listeler.

**Kalanlar (istenen sade hâl):** yalnız başlıklar, etiketler, giriş alanları ve işlev düğmeleri —
**OpenRouter bağlantısı** (API anahtarı + Kaydet, *Modelleri getir*, *API Test*) · **Metin Modeli**
(model adı + Kaydet + "Metin modeline numaralı ekran görüntüsü gönder" onayı) · **Görsel LLM**
(görsel model adı + Kaydet + *Görsel Test (ekranı anlat)*) · **Yap modeli** (model adı + Kaydet) ·
"Çalışırken bu pencereyi küçült" onayı · **Hedef pencere** (seçim + ↻, kayıtlı pencere kapalıysa
*Tüm ekran yap* düğmesi) · **Adımlar arası bekleme (ms)** · **Maks. adım** · *Tümünü Kaydet*.

**Bilinçli istisna:** *Modelleri getir* düğmesinin **geçici durum satırı** korundu ("OpenRouter modelleri
alınıyor… / liste güncellendi / hata mesajı"). Bu kalıcı bir bilgi metni değil, basılan düğmenin sonucudur;
tamamen kaldırılırsa düğme sessiz kalır ve anahtar hatası görünmez. İstenirse bu satır da kaldırılabilir.

## Doğrulama

- `typecheck` ✓ (üç proje) · **Vitest 116 dosya / 917 geçti / 1 atlandı / 0 kırmızı** ✓ (davranış değişmedi;
  kaldırılan metinlere bağlı hiçbir test yok — kontrol edildi).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- Paketlenmiş ASAR'da kaldırılan metinlerin **bulunmadığı**, kalan başlıkların (`OpenRouter bağlantısı`,
  `Metin Modeli`, `API Test`, `Modelleri getir`) **bulunduğu** doğrulandı.
- Önceki sürümlerin düzeltmeleri korunuyor (kütüphane kimliği/toplu silme, koşul tek geçiş, masaüstü kartı).

## Sınırlar

- Arayüz yalnız kod düzeyinde ve vitest ile doğrulandı; **canlı masaüstünde gözle** bakılmadı.
- 1.9.98–1.9.101 notlarındaki diğer açık kalemler değişmedi.
