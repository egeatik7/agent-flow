# Sürüm notu — 1.9.55 (kullanıcının üç isteği)

Kullanıcının kendi isteği (paket değil): *"Tuvaller otomasyon kısmında Düzenle tuşunu **Genişlet/Daralt**
yap; Genişlet tuvalleri açsın, Daralt gizlesin. Üstteki **oynatma** tuşu **hangi tuval aktifse oradan**
başlasın. Bir tuvalde **seçiliden başlat** dersem, o tuval bitince **bir sağdaki tuvale geçip** devam etsin."*

## 1) Genişlet / Daralt
- Otomasyon kartındaki **Düzenle** düğmesi artık **Genişlet** ✓; basınca o otomasyonun **tuval listesi
  açılır** ✓ ve düğme **Daralt**'a döner ✓; **Daralt** listeyi **yeniden gizler** ✓.
- **Aynı otomasyonda** aç/kapa yaparken **taslak korunur** ✓ (kaydedilmemiş üye/sıra değişiklikleri
  kaybolmaz ✗). Başka bir otomasyona geçerken kirli taslak için yine **onay** istenir ✓ (eski davranış ✓).

## 2) Oynatma (▶) aktif tuvalden başlar
- Üstteki ▶ artık **açık (aktif) sekmeden** başlar ✓ ve **sağa doğru** devam eder ✓; **solundaki**
  tuvaller bu oynatmada **çalıştırılmaz** ✓ (eskiden her zaman ilk sekmeden başlıyordu ✗).
- Günlük bunu açıkça yazar ✓: *"Aktif tuvalden sağa doğru oynatılıyor (N tuval)."*

## 3) "Seçiliden Çalıştır" → bitince sağdaki tuvale geçer
- Seçili **adımdan** başlatma artık **tek tuvalde kalmıyor** ✓: aktif tuval seçili adımdan çalışır ✓,
  **Bitti node'una ulaşınca** sıra **sağındaki** tuvallerle devam eder ✓ (her biri Başlangıç'tan ✓).
- Bitti'ye ulaşmayan/hatalı tuvalde **sonraki başlatılmaz** ✓ (mevcut sıra kuralı korundu ✓).
- Günlük: *"Aktif tuval seçili adımdan başlatılıyor; bitince sağdaki tuvallerle devam edilecek (N tuval)."*

## Değişmeyenler
`CanvasSequence`'in doğrulama/iptal davranışı ✓ (Başlangıç ve Bitti şartı ✓, Durdur ✓, hata sonrası
durmak ✓); **Durdur** kalan sırayı **başlatmaz** ✓; üst **▶ Ajanı Çalıştır** (tek tuval) ve tek-adım
çalıştırma **aynı** ✓; OCR, tıklama, yazma ve koşu motoru **değişmedi** ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest 52 dosya: 391/391** ✓ — `tests/canvas-editor.test.ts` etiket değişimine çevrildi ✓ ve **yeni
  bir test** eklendi ✓: *"Genişlet tuvalleri açar, Daralt gizler ve taslak kaybolmaz"* ✓ (bu test ilk
  denemede **gerçek bir kusuru yakaladı** ✗: yeniden Genişlet taslağı sıfırlıyordu → düzeltildi ✓).
- **Sekiz Node regresyon dosyası: 116 pass / 0 fail** ✓
- **Windows PowerShell 5.1'de 10 harness** ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Canlı UI denemesi yapılmadı** ✗ — genişlet/daralt, ▶'ın aktif sekmeden başlaması ve seçiliden →
  sağa devam, gerçek Electron penceresinde **fare ile denenmedi** ✗. Beklenen: Tuvaller → Otomasyonlar →
  **Genişlet** → liste görünür ✓ → **Daralt** → gizlenir ✓; bir tuvali **ortada** seçip ▶ → **ondan**
  başlar ✓; bir tuval seç + bir node seç → **Seçiliden Çalıştır** → o tuval biter ✓ → **sağındaki** başlar ✓.