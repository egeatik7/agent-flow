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
- Moturun (runner/agent) iç davranışı: bu batarya **araç katmanını** sınar; koşu/döngü/odak
  yollarının tamamı burada değil.
- Gerçek masaüstü tıklamaları: canlı katman yalnız **reddetme** yollarını kullandı; tıklama,
  yazma ve Blender arayüzü işleri bu bataryanın dışında (ayrı koşularda ölçülür).
- Uzun koşu eşikleri (§16): bellek/model çağrısı/gecikme ölçülmedi.

## Nasıl yeniden koşulur
```powershell
npm run typecheck
npx vitest run tests/bug-hunt.test.ts        # katman 1
$env:NUBBO_PROFILE='test'
node scripts/dev-start-test.cjs test          # örnek açık olmalı
node scripts/nubbo-cli.cjs call --tool act.type --args-file bosluk.json   # katman 2
```
