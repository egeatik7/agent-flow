# Sürüm notu — 1.9.96 (Tur 2 açıklarının düzeltilmesi)

**Kaynak**: bu sürüm bir patch paketi değil; **1.9.95 üzerinde Tur 2 tarama raporunun**
([bug-taramasi-1.9.95.md](bug-taramasi-1.9.95.md)) en ağır açıklarının düzeltilmesidir. Düzeltmeler
dört ayrı ajan tarafından **dosya sahipliği çakışmayacak** biçimde yapıldı, ardından tam geçit koşuldu.

## Yapılanlar

1. **Çakışmada/kilit hatasında veri kaybı** (§2.A.1, §2.A.2)
   `canvas:save` artık `{ conflict, libraryError? }` döner; kütüphane yazımı herhangi bir nedenle
   başarısız olursa **katalog yazılmaz** (güvence korunur) ama **oturum yazılır** ve hata arayüze
   bildirilir; başarısız yazımda **kayıt tabanı ilerlemez**, sekme kirli kalır ve **başarı mesajı
   gösterilmez**.
2. **Kilit sahipliği kaybından sonra yeniden sahiplenme** (§2.A.2, §2.F.5)
   Kilit dosyası dışarıdan silinirse bayat kayıt düşürülüp kilit **yeniden edinilir**; canlı yabancı
   kilit yine bloklar ve asla silinmez.
3. **Kapanış kilitlenmesi** (§2.B.1)
   Renderer onayı için **zaman aşımı**; yanıt gelmezse bekleyen kayıtlar yazılır, durum günlüğe
   açıkça bildirilir ve pencere kapatılır.
4. **Alt-dize "hazır" kararı ve yükleme sırası** (§2.C.2, §3)
   Tepki yargısı artık **tam kelime** eşleşmesi kullanır; "yükleniyor" sinyali "hazır"dan önce
   değerlendirilir; doğrulama iğnesi komutun tamamı yerine hedef metinden türetilir.
5. **Eşitlikte ilk öğeyi seçme** (§2.C.1)
   Aynı puanda birden fazla aday varsa seçim **yapılmaz**, karar modele bırakılır; model yoksa
   (modelsiz akışlar) eski deterministik davranış korunur.
6. **Model aday listesi sınırı** (§2.C.3)
   Hedef seçimi istemine giden aday listesi deterministik olarak sınırlandı ve satır uzunlukları
   kırpıldı; sınırlama günlüğe yazılır.
7. **Başlangıç node'u** (§2.A.3)
   Başlangıç node'u bağlam menüsünden **silinemez** (çoklu seçimde atlanır, kullanıcı bilgilendirilir)
   ve eksik Başlangıç enjekte edilirken kimlik **deterministik** üretilir → sekme/baseline/katalog
   kimlikleri ayrışmaz.
8. **Koşu sayacı dürüstlüğü** (§2.A.5)
   Döngü dışı adım hatası artık koşu sonucunda **hatalı adım** olarak sayılır; koşu durumu satırı
   "hatalı öğe yok" diyerek hata ile biten koşuyu temiz göstermez.
9. **Motorun klasör listesini canlı tuvale yazması** (§2.A.4)
   Klasör/desen kaynaklı liste geçici koşu durumu sayılır ve kayda girmez; kullanıcının elle girdiği
   liste korunur.
10. **Kanıt kapıları** (§2.F.1)
    Gerçek iki-süreç kilit testi artık bir npm komutuna (`test:lock`) ve kapı zincirine bağlı.
11. **Pencere sertleştirme** (§2.H.2)
    `setWindowOpenHandler` reddi, dış adrese `will-navigate` engeli ve paketlenmiş modda CSP başlığı.
12. **Arayüz** (§2.D.2-§2.D.4, §3)
    `NodeNavigator` Enter'ın hedefi iki kez açması düzeltildi; tuval sekmeleri klavye ile
    gezilebilir (`tabIndex`, ok tuşları, Home/End, Enter/Space); ekran tarayıcıda kapsam değişince
    yeniden tarama tetiklenir; Başlangıç node'u için bağlam menüsünde "Sil" gösterilmez.

## Doğrulama

- `npm run typecheck` ✓ (üç proje) · **Vitest 108 dosya / 838 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.95 tabanı 104/778/1 → **+4 dosya / +60 test** ✓).
- **Beş Node paketi** ✓ (keys 3, input 7, recovery 27+12 atlandı, targeting 20, stability 40+9 atlandı)
  ve **yeni `test:lock`** ✓ (gerçek iki-süreç kilidi yarışı artık kapıda).
- **On bir PS 5.1 harness'i** exit 0 ✓.
- Kırmızı yakalamaları (yayın öncesi kapatıldı): `test:stability` 12 kırmızı → VM harness'ı
  `newTally`'yi sağlamıyordu ve hata `try` bloğundan ÖNCE atıldığı için `finally` temizliği hiç
  koşmuyordu (yan etkisi iki "çalışma durumu" testini de düşürüyordu) ✓ düzeltildi ·
  `tests/word-targets.test.ts` eski sınırsız-liste sözleşmesini iddia ediyordu → kasıtlı güncellendi ✓ ·
  `tests/fix-tur3-*` tip hataları (`LibrarySection`, possibly-undefined) ✓ düzeltildi ·
  sayaç şeklinin tek tanımı `newTally()`'ye döndürüldü (satır içi kopya kaldırıldı) ✓.
- Ölçülen ama bu sürümde **bilinçli bırakılan** küçük kalem: sahiplik kaybı sonrası yeniden
  sahiplenme yolunda `withLibraryLock` bir kez daha sayaç artırdığı için, uygulama kapandıktan sonra
  kilit dosyası diskte kalabilir; bir sonraki açılışta ölü sahip olarak güvenle devralınır (zararsız).

## Doğrulanmayan / bu sürüme **alınmayan**

- Bozuk/kilitli klasör gibi **gerçek dosya sistemi arızalarının canlı Windows'ta** sınanması ✗.
- **`typeText`'in korumalı dalı** üretimde hâlâ kullanılmıyor ✗: düzeltmek eylemden önce engelleyen
  bir kapıyı geri getirme riski taşıdığı için **kullanıcı kararına** bırakıldı (§19).
- **Yap node'unda kod çalıştırmanın varsayılan açık olması** ✗: varsayılan davranış değişikliği açık
  onay gerektirir.
- ONNX okuyucu yüklenemezse arayüzde görünmemesi ✗ · yerel uç nokta anahtar desteği ✗ ·
  profil adı→klasör adı çakışması ✗ · paketlenen exe'nin "Electron / GitHub, Inc." damgası ✗ ·
  `dev-scenario` input-sent atlaması ✗ · izin kapsamının girdi göndermeyen araçlara uygulanmaması ✗.
