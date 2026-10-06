# Kabul pilotu — gerçek Windows, 6 Ekim

Bu dosya, "Nubbo'yu Nubbo ile onarma" döngüsünün **uçtan uca** kabul koşusunun kanıtıdır.
Fıkstür: `dev-seed-fixture.cjs test loop` → tuval "Pilot": **paket içinde bir döngü** (iki öğe),
her öğede `%TEMP%\nubbo-pilot\loop-<sıra>.txt` yazan bir adım ve **kasıtlı olarak bulunmayan**
bir yazıya tıklayan bir adım.

Sınıflar ayrı tutulur: **araç cevap verdi · girdi gönderildi · gözlenen sonuç · görev tamamlandı**.
Aşağıdaki her satır **gözlenen sonuçtur** (diskte dosya, motorda adım/hata, kayıtlı tuvalde içerik).

## Zincir ve sonuçlar

| # | Adım | Gözlenen |
|---|---|---|
| 1 | `from --start --debug --fast` | *durduruldu (hata sonrası durdu) · 6 tamam, 2 hata* |
| 2 | `report` | `"Pilot · bulunmayan yazıya tıkla"` · kutu **`1/2 ("bir")`** · paket `pilot-package` · hata: **`bir: "YOK-BU-YAZI-ASLA-YOK" ekranda bulunamadı.`** · görüntü: `…\1.9.26-dev\hata-…-bir.jpg` |
| 3 | `edit --package pilot-package` | *"hedef: paket «Pilot · paket ve döngü» içinde · Akışına hiçbir şey yazılmadı."* |
| 4 | `show --branch` | *"tuvalde gösterildi (İncele gibi): **1 node değişti**"* |
| 5 | `from --branch … --node pilot-bad-click --until pilot-bad-click` | *"tamamlandı · 2 adım · **3 tamam, 0 hata**"* (yalnız onarılan bölge) |
| 6 | `from --branch … --node pilot-bad-click --resume` | *"hatadan devam (**koşu rmux39m3v-1, fmux3b4ej72ow**): «Pilot · iki öğe» **1/2 («bir»)** · değişkenler: `oge=bir, oge.yol=bir, oge.ad=bir, oge.isim=bir, sira=1, toplam=2`"* |
| 7 | `wait` | *"tamamlandı · 7 adım · **8 tamam, 0 hata**"* (döngü iki öğeyi de bitirdi) |

## Ölçülen sonuçlar

- `loop-1.txt = 'bir'` · **22:46:12** — ilk turdaki zaman **aynen kaldı**: yan etkili iş **iki kez yapılmadı**.
- `loop-2.txt = 'iki'` · 22:47:47 — devam eden koşu **ikinci öğeye** geçti ve **doğru değeri** yazdı.
- Kayıtlı tuvalde `pilot-bad-click` hedefi hâlâ **`YOK-BU-YAZI-ASLA-YOK`** → **asıl akış değişmedi**;
  onarım **branch tarifinde** duruyor.

## Bu koşuda bulunan ve düzeltilen gerçek kusurlar

1. **Onarım referansı kayboluyordu**: araya giren sınırlı test yeni bir koşu başlatınca önceki donmuş
   rapor **arşive** alınıyor, ama varsayılan arama arşive bakmıyordu → `resumeFromFailure`
   *"Devam edilecek donmuş hata yok"* diyordu. Artık geçerli hata yoksa **en son saklanan** hata bulunur
   ve cevap **hangi koşudan** devam edildiğini söyler (`koşu rmux39m3v-1, fmux3b4ej72ow`).
2. **Paket içindeki kutu bulunamıyordu**: devam, kutuyu yalnız **kök** node listesinde arıyordu →
   *"Bazı kutular bu branch'te yok"* diyordu. Artık ağaç üzerinden aranıyor; canlı devam bunu kanıtladı.
3. **CLI'da paket yolu yoktu**: paket içi düğümü düzenlemek `packagePath` ister; `edit --package` eklendi.

## İkinci hata yarısı (aynı koşuda, iki bozuk adımlı fıkstür)

Fıkstür v2: döngünün içinde **iki** bozuk adım (`pilot-bad-click`, `pilot-bad-click2`).

| # | Adım | Gözlenen |
|---|---|---|
| 8 | `from --branch … --node pilot-bad-click --resume --debug` | Onarım 1 çalıştı; **ikinci hata** ortaya çıktı ve dondu: `fmux3jzdnj2bo` · kutu **`1/2 ("bir")`** |
| 9 | `edit --package` (**aynı** dalda) | *"**2 düzenleme · 2 işlem**"* → onarım 1 **kaybolmadı** |
| 10 | `branch diff` | **İki** değişiklik birlikte: `pilot-bad-click` `YOK-BU-YAZI-ASLA-YOK → Nubbo Agent Studio` **ve** `pilot-bad-click2` `YOK-BU-YAZI-2-DE-YOK → Nubbo Agent Studio` |
| 11 | `from --node pilot-bad-click2 --until pilot-bad-click2` | *"tamamlandı · 2 adım · **3 tamam, 0 hata**"* (yalnız bölge) |
| 12 | `from --node pilot-bad-click2 --resume` | *"hatadan devam (**koşu rmux3jlux-2**): 1/2 («bir») · aynı değişkenler"* → *"tamamlandı · 8 adım · **9 tamam, 0 hata**"* |

**Kapanış ölçümleri:**
- `loop-1.txt = 'bir'` · **22:52:53** — bütün zincir boyunca **değişmedi** ✓ (yan etki iki kez yapılmadı).
- `loop-2.txt = 'iki'` · 22:54:38 ✓ (ikinci öğe kendi değerini aldı).
- Öneri dalında **2 düzenleme** ✓ (onarım 1 + onarım 2 birlikte).
- Kayıtlı tuvalde **iki bozuk hedef de yerinde** ✓ (`YOK-BU-YAZI-ASLA-YOK`, `YOK-BU-YAZI-2-DE-YOK`) → **asıl akış değişmedi**.

## Yerel basamak açığı — kök neden (ölçüldü, iki yanlış iddia düzeltildi)

**Ölçüm** (aynı ekran, aynı saniye, salt-okunur ✓):

| Kim | Ne görüyor / diyor |
|---|---|
| Okuyucu (`screen.read`) | `'Kaynak klasör' · Text · uia (98,301)` **ve** **`'Kaynak klasör' · Edit · uia (298,301) 440x38`** ✓ |
| Çözücü (`target.preview --fast`) | *"Hiçbir basamak aday listesi vermedi"* ✗ · iz: **yalnız `chrome`** ✗ |
| Koşu, tıkla node'u | **buldu ve tıkladı** ✓ (fıkstür: `mouse:source`, `focused: True`) |
| Koşu, yaz node'u | *"«Kaynak klasör» ekranda bulunamadı"* ✗ |
| Model açıkken (tars) | alanı buluyor ✓ → `ui-real` geçiyor, `ui-local` geçmiyor |

**Kök neden** (`electron/agent.ts:409`): merdivenin `uia` basamağı **yalnızca node'un kayıtlı öğesi varsa**
(`locator.automationId` / `locator.name` ✓) çalışıyor. Yalnızca **yazılı komutu** olan bir node için
UIA ağacına **hiç sorulmuyor** ✗; merdiven OCR yazılarıyla yetiniyor ✓. Bu, **tıklama** için yeterli
(etiketin yerine tıklanır ✓, alan odaklanır ✓) ama **yazma** için yetmez ✗: yazmak alanın *kendisini*
gerektirir ✓ ve alan yalnız UIA ağacında görünüyor ✓ (`Edit` ✓). Model bu boşluğu ekran görüntüsüyle
örtüyor ✗ — yani §10'daki *"basit ve kesin iş yerelde çözülebiliyorsa modele gönderilmez"* kuralı bu
yolda **sağlanmıyor** ✗.

**Düzeltilmiş iddialar** (kanıt gelmeden söylenmişti ✗): (1) "koşunun ilk taraması 3 pencere köküne
bakıyor, bu yüzden görmüyor" ✗ — tarama 183 öğe gördü ✓ ve etiket bazı koşularda bulundu ✓;
(2) "tıkla/yaz ayrımı bir süzgeç yüzünden" ✗ — sorun basamağın **hiç çalışmaması** ✗.

**Önerilen en küçük düzeltme** ✓: yazma (ve istenirse tıklama) node'u için, **yazılı komutu** olan ve
kayıtlı öğesi olmayan durumda da UIA ağacından **yazılabilir** (Edit/Document) ve adı komutla eşleşen
öğe aranmalı ✓; kabul kanıtı §8'e göre: **tam değer okunacak** ✓, salt-okunur/devre dışı kabul
edilmeyecek ✗. Kabul ölçütü: **`ui-local` model kapalıyken geçmeli** ✓.

**Ayrıca bulunan iki küçük kusur** ✗: (a) `until` sınırı başlangıç node'uyla aynıysa koşu durmuyor ✗;
(b) koşu hatası **hangi node'da** düştüğünü söylemiyor ✗ (kutu içinde öğe adı geçiyor ✓).

## Kapanış — açık kapandı ✓ (canlı kanıt)

`uia` basamağı artık **yazılı komutu olan** node'lar için de koşuyor:
- **Yazma**: yalnız **yazılabilir** öğe (`Edit`/`Document`/`ComboBox`) ve adı komutla **tam** eşleşen öğe;
  kabul kanıtı yazdıktan sonra **değerin geri okunması** (§8 ✓) → salt-okunur alan bu kontrolü geçemez.
- **Tıklama**: adı eşleşen öğe; **gerçek denetim**, yazı etiketine yeğlenir; birden fazlaysa **son tıklamaya en yakın**.

| Senaryo | Model | Sonuç |
|---|---|---|
| `ui-local` | **KAPALI** | **Koşu geçti**: `ok:true · failed:0 · steps:5` ✓ · `Alan doğrulandı` ✓ · `"text":"nubbo-ui-test"` ✓ · `"id":"continue"` ✓ |
| `ui-real` | AÇIK | **GEÇTİ 16/16** ✓ (aynı sonuçlar) |

**Beklenmedik iyi haber** ✓: model kapalı koşuda fıkstür **önde değildi** (`host-foreground` ✗) ve akış
**yine de geçti** → "sürülen pencere önde olmalı" ön koşulu bu iş için gerekli değilmiş ✓.

**Kabul edilmesi gereken davranış değişikliği** ✗✓: yazılı komutlu **tıkla/yaz** node'u artık `uia`
basamağında (metin basamaklarından **önce**) öğe arıyor → tıklama, yazının kutusunun ortası yerine
**öğenin** ortasına düşüyor. Kayıtlı öğesi olan node'larda davranış **değişmiyor** ✗.

**Küçük kusurlardan biri kapandı** ✓: tek adımlık sınır (`until` = başlangıç) artık **dürüstçe
reddediliyor** ✓ (`"…tek adımlık bölge bu yolla ölçülemez… step.run kullan"` ✓). Diğeri zaten
karşılanıyor ✓: koşu hatasının **hangi node'da** olduğunu `run.report` donmuş raporda söylüyor ✓.

**Henüz ölçülmemiş olan** ✗ (dürüst sınır): gerçek Hunyuan–Blender akışında **saatlerce uzun koşu**;
bellek/model çağrısı/gecikme eşikleri (§16) — bunlar gerçek görevle ölçülmeden "robust" denmez ✗.


`Nubbo Agent Studio` **yerel basamaklarla bulunamadı** ve bu *ikinci hatayı* üretti. Aynı hedef, model
açıkken (11. adım) bulundu. Yani yerel basamak açığı burada da görünür durumda; onarımın kendisi doğru.

## Güvenlik notu (bu döngü için)

Bu koşular **gerçek fareyi ve klavyeyi** kullanır. Bu yüzden her koşudan önce
`scripts/dev-idle.cjs` ile **son girdiden bu yana geçen süre** ölçülür; insan son 60 saniyede bir
şeye dokunduysa koşu **başlatılmaz** (senaryo koşucusu bunu zorunlu tutar, çıkış kodu 4).
Bu kural, bir koşunun kullanıcının odağını ve tıklamasını çalmasından sonra eklendi.
