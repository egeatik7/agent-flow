# Aşırı detaylı bug testi — 7 Ekim 2026

Bu dosya, araç katmanını **doğrulamak için değil kırmak için** yazılmış bir bataryanın sonucudur.
Sınıflar ayrı tutulur: her satır ya **ölçülmüş bir davranış** ya da **ölçülmüş bir kusurdur**;
"olması gerekiyordu" diye yazılmış hiçbir şey kanıt sayılmaz.

## Yöntem — üç katman

| Katman | Ne yapar | Kaç kontrol | Nereye dokunur |
|---|---|---|---|
| **1. Birim bataryası** (`tests/bug-hunt.test.ts`) | Bilinmeyen kimlikler ✓, boş/boşluk argümanlar ✓, sınırlar ✓, yasak alanlar ✓, dolu çıkışlar ✓, eşzamanlılık ✓, merge hakları ✓, değişmezler | **14 test** | Masaüstüne **dokunmaz** |
| **2. Canlı batarya** (`nubbo call …`) | Aynı reddetme yolları **çalışan uygulamaya** karşı | **9 çağrı** | Yalnız **reddetme** yolları: ekrana girdi **gitmez** |
| **3. Değişmez ölçümü** | Gerçek profilin deposu **bayt bayt** aynı mı | 3 ölçüm (hash · boyut · apiKey) | Salt okuma |

## Bulunan **gerçek** hatalar (iki tane; ikisi de düzeltildi)

### H1 — Boşluktan oluşan argüman korumayı geçiyordu (DÜZELTİLDİ ✓, canlı doğrulandı ✓)
`act.type { text: "   " }` ve `act.key { keys: "  " }` **guard'ı geçiyor** ve motora ulaşıyordu.
Canlı ölçüm: *"Araç çalıştırılamadı: Odak bir yazı alanı değil (Window)"* — yani motor **yazmayı
denedi**; odak bir metin alanı olsaydı pencereye **boşluk yazacaktı**.
**Düzeltme:** bu üç eylemde argüman `trim()` edilir. Yeni build'de canlı: `ok=False` ·
*"Ne yazılacağını söyle…"* ✓ ve *"Hangi tuş…"* ✓.

### H2 — İşlemsiz `flow.edit` "oldu" diyordu (DÜZELTİLDİ ✓)
`flow.edit { branchId, ops: [] }` kabul ediliyor ve **başarı** raporlanıyordu: hiçbir şey
değişmeden "değişti" demek. **Düzeltme:** boş plan reddedilir
(*"İşlem listesi boş: ne değişeceğini yaz"*).

## Geri çekilen bulgular ✗✓ — hata değil, **testimin sözleşme hatası**

İlk koşuda "yasak alan kabul edildi" (H3) ve "branch'te dolu çıkış kabul edildi" (H4) diye iki bulgu
yazmıştım. **Yanlıştı.** İkisi de aracın **kendi sözleşmesini** yanlış okumaktan çıktı:

> Bir **plan** reddi `ok: false` değil, **`ok: true` + `outcome: "plan-gecersiz"`** olarak bildirilir
> ("araç cevap verdi; plan geçersiz"). `ok: false` ise "araç çalıştırılamadı" demektir.

Sözleşme doğru okunarak sınandığında ikisi de **doğru çalışıyor** ✓:
- `flow.suggest` `locator` alanını **reddediyor** ✓ (`outcome: plan-gecersiz`, `data.valid: false`, mesajda `locator` ✓)
- Branch bağlamında dolu çıkışa `addNode.connectFrom` **reddediliyor** ✓ (*"…çıkışında zaten bir bağlantı var"* ✓)

**Ders:** bir kusuru "buldum" demeden önce **aracın sözleşmesini** doğrula. Bu batarya tam da bunu
yapmadığı için iki yanlış bulgu üretti; ikisi de geri çekildi ve testler doğru sözleşmeye çevrildi.

## Gerçek ve **açık** kalan küçük bulgu ✗ — iki farklı reddetme sözleşmesi
Araç katmanı bir reddi iki ayrı biçimde bildiriyor ve çağıran hangisini okuyacağını **bilmek zorunda**:
- `flow.suggest`, `flow.edit` → `ok: true` + `outcome: "plan-gecersiz"` (plan reddi)
- `run.from`, `branch.show`, `branch.drop`, `target.preview`, `flow.context` → `ok: false` (çağrı reddi)

Bu tutarsızlık bataryayı da yanılttı. Davranışı değiştirmek mevcut çağıranları bozacağı için
**düzeltilmedi, kayda geçirildi**; tek sözleşmeye alınacaksa sürüm notuyla yapılmalı.

## Doğru çıkan davranışlar (ölçüldü ✓)

- **Bilinmeyen kimlik**: `branch.drop/diff/show`, `flow.undo/edit`, `branch.merge`, `run.from`
  (node ve sınır), `target.preview`, `flow.context` → hepsi **net reddeder**, hiçbiri çökmez ✓
- **Onaysız baştan koşu** ve **sınır = başlangıç** → reddedilir ✓ · **sınırsız başlangıç** → reddedilir ✓
- **Bilinmeyen koşu kimliği** (`run.report`) → uydurmaz, *"bulunamadı"* der ✓
- **Sınırlar**: 4. branch reddedilir ✓ · 40 düzenlemede tarif **dolar** ve **mevcut gruplar silinmez** ✓
- **Yasak alanlar**: `flow.suggest` ve `flow.edit` `locator` alanını **reddeder** ✓
- **Dolu çıkış**: düz akışta ve **branch bağlamında** reddedilir ✓ · **tek planda kopar-bağla** çalışır ✓
- **Merge**: deneme her zaman serbest ✓ · **uygulama yalnız panelden** ✓ · geri alma hakkı **bir kez** ✓
- **Eşzamanlılık**: koşu sürerken `act.click`/`act.type`/`act.key`/`run.from`/`act.wait` **başlamaz** ✓
- **Hedef aramayan node'lar** (bekleme, bitir, kutu, başlangıç) için `preview` *"bulamadım"* demez ✓
- **Debug kapanı + arşiv**: üst üste koşular önceki kanıtı **silmez** ✓
- **Değişmez (en güçlü kontrol)** ✓✓: bataryadan sonra araç katmanı yalnız `branches` yazar;
  **tuvaller bayt bayt aynı** kalır ✓ — ve **gerçek profilin deposu** hash/boyut/apiKey olarak
  **birebir aynı** ✓✓ (canlı batarya dahil)

## Canlı batarya sonucu (çalışan uygulamaya karşı)
9 çağrıdan **7'si doğru reddetti** ✓; 2 sapma **eski çalışan build** yüzündendi ✗
(düzeltmeler o build'de yoktu). Paket yenilendi, örnek yeniden başlatıldı ve **aynı iki madde
yeni build'de doğru reddetti** ✓✓. Bu, incelemenin "damga derlemeye gömülmeli" uyarısının neden
önemli olduğunun canlı kanıtıdır.

## Bu bataryanın **kapsamadığı** şeyler ✗
- Moturun yürütücü kısmı: graf gezinme, döngü kuralları, yargı ve hafıza **Katman 4'te** sınandı ✓;
  ama eylemlerin gerçek uygulamaya karşı çalışması hâlâ kapsam dışı ✗.
- Gerçek masaüstü tıklamaları: canlı katman yalnız **reddetme** yollarını kullandı; tıklama,
  yazma ve Blender arayüzü işleri bu bataryanın dışında (ayrı koşularda ölçülür).
- Uzun koşu eşikleri (§16): **saatler** süren bellek/model çağrısı/gecikme ölçülmedi ✗.

## Katman 4 (ikinci tur): **moturun saf mantığı** — 24 kontrol

İlk batarya yalnız **araç katmanını** sınamış ve "moturun iç davranışı kapsam dışı" diye yazmıştı.
Bu katman o boşluğu kapatır: `tool-context` (graf gezinme), `graph-types` (döngü kuralları),
`runner` (giriş noktası, API kesintisi ayrımı, kesilebilir bekleme), `confirm` (tepki yargısı),
`matcher` (yazı eşleştirme), `memory` (hafıza çelişkisi), `run-events` ve `profile`.

**Sonuç:** ürün hatası **bulunmadı** ✗ — çünkü bu kez **önce sözleşmeler okundu** (önceki turun
dersi). Buna karşılık 24 beklentimin **5'i yanlıştı** ve ölçümle düzeltildi:
`walkGraph` düğüm değil **`NodePlace`** veriyor ✓ · `itemVars` anahtarları **normalleştiriyor** ✓ ·
`norm('İNDİR')` → `'indir'` (birleşen nokta atılıyor ✓) · `noteActPoint({x,y})` nesne alıyor ✓ ·
`stopReason()` sınır **konunca** değil **durulunca** doluyor ✓.

**Yeni kanıtlanan davranışlar** (daha önce hiç sınanmamıştı):
- **Döngü güvenli gezinme**: kendine bağlı düğümde gezinme **sonlanıyor** ✓ (sonsuz döngü yok ✓)
- **İç içe kutular**: dış → iç sırası ✓ ve iç node paketin yolunu görüyor ✓
- **Döngü kuralları**: liste kırpılır/boş satır düşer ✓ · sayım modunda `#1..#N` ✓ ·
  `startIndex` sınırlanır (negatif→0 ✓, NaN→0 ✓, taşan→son ✓, `resume:false`→0 ✓)
- **API kesintisi ayrımı (§9)**: 3 gerçek kesinti tanındı ✓ **ve 5 sıradan hata kesinti sayılmadı** ✓
  (yanlış pozitif, bütün listeyi boşuna durdururdu ✓)
- **Profil ayrımı**: yalnız **test** profili kendi çalışma klasörünü alır ✓; gerçek profilde `undefined` ✓
  → **gerçek depo yerinden oynayamaz** ✓
- **Türetilmiş koşu tuvali ışıklandırmaz**: `agent:step`/`agent:patch` reddedilir, `agent:log` geçer ✓
- **Yargı dürüstlüğü (§17)**: "hazır" **yalnız** beklenen yazı **yeni** geldiğinde ✓; ölçüm:
  `judgeScreen` zaten duran yazı için **`missed`** dedi (*"…tıklama ekranı değiştirmedi"* ✓) — **başarı demedi** ✓
- **Hafıza (§6)**: en fazla **5** kayıt ✓, yeni kayıt başta ✓; başka pencere ✓ veya ekranın
  bambaşka yeri ✓ **çelişki** olarak bildirilir, sessizce kullanılmaz ✓
- **Kanıt arşivi sınırlı (§9 bellek)**: ölçüm → **30 debug koşusundan sonra 4 rapor** tutuluyor ✓
- **Durdurma gecikmesi (§9)**: 5 saniyelik bekleme, istek gelince **600 ms altında** kesiliyor ✓
- **Giriş noktası**: açık kimlik > `Başlangıç` > girdisi olmayan ilk node ✓

**Hâlâ kapsam dışı** ✗: yürütücünün masaüstüne dokunan kısmı (tıklama/yazma/döngü, gerçek
uygulamaya karşı) ve **saatler süren** kaynak/gecikme eşikleri (§16).

## Canlı koşunun **ön koşulu**: hedef pencere önde olmalı (ölçüldü, 7 Ekim)

Canlı senaryolar (fikstür penceresine yazan/yazanı doğrulayan koşular) **hedef pencerenin önde
olmasını** bekler. Ölçülen iki durum:

- Önde **Blender** varken (dün gece açık kalan oturum): senaryo "Kaynak klasör"ü Blender'ın içinde
  aradı, bulamadı ve **KALDI** yazdı. Ekran okumasında `Rendering`, `Compositing`, `Geometry Nodes`
  görünüyordu.
- Önde **arayüz penceresi** varken (sohbet penceresi): aynı senaryo bu kez `New session`, `deepseek`
  gibi yazılar gördü ve yine **KALDI** yazdı.

İkisi de **ürün hatası değil** ✗: motor hedefi bulamadı ve **körlemesine yazmadı** ✓ (§6'ya uygun).
Ama bu durumda senaryonun kararı **ürünü sınamaz** ✗; "KALDI" kaydı yanıltıcı olur.

**Ölçülen ek kısıt:** §18'deki boş-ekran kapısı (`GetLastInputInfo`) döngüyü yürüten ajanın **kendi
penceresini göremez** ✗ — ajanın çağrıları "girdi" değildir, o yüzden kapı açık kalır ve senaryo
koşar. Bu yüzden canlı koşu öncesi ön plan **açıkça** doğrulanmalıdır.

**Elde ne var:** `scripts/dev-raise.ps1 -Show` → şu an önde olan pencereyi `hwnd · pid · süreç ·
başlık` olarak söyler; `-Title "..."` ile hedef pencereyi öne almaya çalışır. `scripts/dev-minimize.ps1
-Title "test profili"` → bir pencereyi kapatmadan küçültür.

**Ölçülen doğru kural (düzeltme):** Arka plandaki bir süreç ön planı **başka** bir pencereden
alamıyor ✗ — ama ön planı **tutan pencere ortadan kalkınca** (kapatılınca) ya da **küçültülünce**
hedef pencere kendini öne alabiliyor ✓. Bu yüzden canlı koşunun gerçek ön koşulu şudur:

1. Fikstürü/test örneğini değil, **ön planı tutan uygulamayı** küçült ya da kapat.
2. Test örneği açılırken ön planı alır ✗ → bu yüzden **başlatıcı artık örneği kendisi küçültüyor**
   (`dev-start-test.cjs` → `dev-minimize.ps1`) ✓.
3. Koşudan önce **60 saniye** girdi olmamalı (boş-ekran kapısı) ✓ — ve her koşunun kendi girdisi
   sayacı sıfırlar ✗, bu yüzden koşular arasında beklemek gerekir ✓.

Bu üç madde uygulandığında üç canlı senaryo **geçti** (7 Ekim): `ui-local` **16/16** ✓,
`package-inner` **12/12** ✓, `region-bounded` **11/11** ✓.

**Ölçülen bir tuzak (kendi aracımda, üründe değil):** Portable exe kendini geçici bir klasöre açıp
oradan çalışıyor ✗ — süreç adı ürün adı (`Nubbo Agent Studio.exe`), yolu `…\Temp\<rastgele>\…` ✓.
Bu yüzden ne **ad** ne **yol** tek başına kimlik doğrulamaya yetiyor ✗; süreç **ya da ebeveyni**
bizim kopya olmalı ✓ (`dev-start-test.cjs`). Ve **isimle toplu öldürme yasak** ✗: bir kez
`taskkill /IM Nubbo-test.exe` satırı vardı, kaldırıldı ✓; asıl ders daha ağır — ben elle
`Nubbo-1.9.26-dev` stub'ını ağacıyla kapatırken **sahibinin açık uygulamasını** da kapattım ✗✗
(veri kaybı olmadı ✓: gerçek depo dosyasına dokunulmadı ✓, ama penceredeki kaydedilmemiş durum
gitti ✗). Kural: kapatma **yalnız** jetonun gösterdiği pid ile ve kimliği doğrulanarak yapılır ✓.

## Nasıl yeniden koşulur
```powershell
npm run typecheck
npx vitest run tests/bug-hunt.test.ts        # katman 1
$env:NUBBO_PROFILE='test'
node scripts/dev-start-test.cjs test          # örnek açık olmalı
node scripts/nubbo-cli.cjs call --tool act.type --args-file bosluk.json   # katman 2
```
