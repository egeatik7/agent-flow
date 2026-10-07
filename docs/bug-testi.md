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

## Bulunan **gerçek** hatalar

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

### H3 — `flow.suggest` yasak alanı kabul ediyor (AÇIK ✗ — `it.fails` olarak kayıtlı)
`flow.edit`, `EDITABLE_FIELDS` denetimiyle (`electron/tool-edit.ts:129`) `locator` alanını
reddeder; **`flow.suggest` aynı denetimi çalıştırmıyor** ve hedef kanıtı alanını kabul ediyor.
Yani "planı denetle" diyen araç, düzenlemenin reddedeceği bir planı onaylıyor.
Kabul ölçütü: `flow.suggest` `locator`/`icon`/`memory`/`anchor`/`path`/`trace` alanlarını reddetsin.

### H4 — Dolu çıkış denetimi branch'te temel akışı görmüyor (AÇIK ✗ — `it.fails` olarak kayıtlı)
Kural `electron/tool-edit.ts:240-248`'de **var** ve düz akışta çalışıyor; ama bir **branch**
içinde `addNode.connectFrom` çağrıldığında denetim yalnız branch'in kendi eklemelerini görüyor,
**temel akışta o çıkış zaten dolu olsa bile** kabul ediliyor.
Sonucu ağırdır: motor bir çıkışta **ilk oku** izler → eklenen node **hiç çalışmaz** ve akış
sessizce eksik kalır (ürünün §9 "bir öğenin hatası bütün liste tamamlanmış gibi raporlanmasın"
kuralının akrabası). Kabul ölçütü: branch bağlamında da temel grafiğin dolu çıkışı reddedilsin.

## Doğru çıkan davranışlar (ölçüldü ✓)

- **Bilinmeyen kimlik**: `branch.drop/diff/show`, `flow.undo/edit`, `branch.merge`, `run.from`
  (node ve sınır), `target.preview`, `flow.context` → hepsi **net reddeder**, hiçbiri çökmez ✓
- **Onaysız baştan koşu** ve **sınır = başlangıç** → reddedilir ✓ · **sınırsız başlangıç** → reddedilir ✓
- **Bilinmeyen koşu kimliği** (`run.report`) → uydurmaz, *"bulunamadı"* der ✓
- **Sınırlar**: 4. branch reddedilir ✓ · 40 düzenlemede tarif **dolar** ve **mevcut gruplar silinmez** ✓
- **Yasak alanlar**: `flow.edit` `locator` alanını reddeder ✓ (H3: `suggest` etmiyor ✗)
- **Dolu çıkış**: düz akışta reddedilir ✓ (H4: branch'te değil ✗) · **tek planda kopar-bağla** çalışır ✓
- **Merge**: deneme her zaman serbest ✓ · **uygulama yalnız panelden** ✓ · geri alma hakkı **bir kez** ✓
- **Eşzamanlılık**: koşu sürerken `act.click`/`act.type`/`act.key`/`run.from`/`act.wait` **başlamaz** ✓
- **Hedef aramayan node'lar** (bekleme, bitir, kutu, başlangıç) için `preview` *"bulamadım"* demez ✓
- **Debug kapanı + arşiv**: üst üste koşular önceki kanıtı **silmez** ✓
- **Değişmez (en güçlü kontrol)**: bataryadan sonra araç katmanı yalnız `branches` yazar;
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
