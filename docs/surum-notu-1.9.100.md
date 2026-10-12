# Sürüm notu — 1.9.100 (masaüstü bilgi kartı node değişimini gösterir)

**Kaynak**: kullanıcının bildirdiği canlı kusur (patch paketi değil).

## Kullanıcının bildirimi

> "şu an masaüstü bilgi kartında node değişince güncellememe sorunu var, mesela koşul nodesi zamanlayıcıya
> geçince ben bunu kartta göremiyorum, hemen düzelt bu sorunları"

## Kök neden (kodda ölçüldü)

Masaüstü kartının **yöntem satırı** (`hud:method`) yalnız Tıkla / Yazı Yaz / Koşul yollarında yazılıyordu
(`electron/agent.ts` içindeki `ctx.setMethod` çağrıları) ve **hiçbir node başlangıcında sıfırlanmıyordu**.
Bu yüzden Koşul'dan sonra Zamanlayıcı (ya da Tuş Gönder / Yap / döngü) adımı başladığında kartta hâlâ
"Koşul: uygulama öğeleri (UIA)" / "Koşul: Windows + ONNX OCR" yazıyordu.

İkinci kusur: kartın **metin satırı** (`hud:status`) yalnız günlük satırlarından besleniyor; döngü, paket,
Başlangıç ve Bitir adımları kendi günlük satırını yazmadığı için o türlere geçildiğinde kart metni de eski
node'da kalıyordu.

## Düzeltme (`electron/main.ts`, motor değişmedi)

1. Koşunun kendi grafiği (`hudRunGraph`, paketler dahil) koşu boyunca elde tutulur ve koşu bitince bırakılır.
2. Her **adım başlangıcı** (`agent:step` + `status:'running'`) çalışan node'u bu grafikten çözer ve kartın
   yöntem satırını **node etiketi · başlık** olarak yazar — ör. `Zamanlayıcı · Zamanlayıcı 1`,
   `Koşul · Koşul 1`; ajan kendi yöntemini (ör. "Koşul: uygulama öğeleri (UIA)") sonra inceltir.
3. Kendi günlük satırını yazmayan türlerde (döngü, paket, Başlangıç, Bitir) **kart metni de** buradan
   güncellenir; Tıkla/Yazı Yaz/Tuş/Zamanlayıcı/Koşul/Yap türlerinde kendi adım günlüğü yazdığı için
   **çift satır üretilmez**.
4. Koşu sürerken değilken ve **türetilmiş (branch) koşularda** kart güncellenmez; kurtarma sürerken yöntem
   satırı mevcut "Kurtarma ajanı · …" bağlamını korur.

## Doğrulama

- Yeni `tests/fix-tur5-hud.test.ts` **6/6** ✓ — gerçek `hudStep`/`pushMethod`/`LOGGED_STEP_KINDS` gövdeleri
  `main.ts`'ten çıkarılıp sanal bağlamda koşturuluyor: Koşul→Zamanlayıcı geçişinde satırın yeni node'u
  yazdığı, kendi günlüğü olan türlerde kart metninin çiftlenmediği, döngü/paket türlerinde kart metninin
  güncellendiği, `done` adımının ve bilinmeyen kimliğin kartı tazelemediği, koşu dışında/türetilmiş koşuda
  dokunulmadığı, kurtarma önekinin korunduğu ve **paket içindeki node'un da adıyla** gösterildiği ölçülüyor.
- `typecheck` ✓ (üç proje) · **Vitest 116 dosya / 911 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.99 tabanı 115/905 → **+1 dosya / +6 test**).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- Paketlenmiş ASAR'da `hudStep` ve `LOGGED_STEP_KINDS` izleri doğrulandı.

## Sınırlar

- Bu düzeltme **kartın metin/yöntem satırlarını** ilgilendirir; canlı masaüstünde gerçek bir koşuyla
  (Koşul → Zamanlayıcı geçişi) gözle doğrulama **yapılmadı** — testler `vm` düzeyinde.
- 1.9.98/1.9.99 notlarındaki açık kalemler değişmedi (typeText'in korumalı dalı, Yap `allowCode`
  varsayılanı, ONNX hatasının görünmemesi, izin kapsamı, yerel model anahtarı, profil klasörü çakışması,
  exe damgası, canlı Windows/tablet testi).
