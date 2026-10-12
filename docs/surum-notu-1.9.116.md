# Sürüm notu — 1.9.116 (görüntü rozeti çözümlemesi + dürüst `marked/plain`)

**Kanıt (istek `mv5s6a40-7`)**: Qwen adres kutusunu doğru tarif etti ve **id 36** döndürdü; program
"#36 bu listede yok" diyerek reddetti ve GLM'e geçti. Kaydedilen **gerçek gönderilen görüntü** incelendi:
görüntü **marked** (rozetler çizili) ve **36 tam olarak üstteki adres kutusunun üzerinde** — yani Qwen
numarayı **uydurmadı**, görüntüden okudu ve doğru alanı işaret etti.

## Kök neden: iki numara dünyası

| | Görüntüdeki rozetler | Gönderilen aday listesi |
| --- | --- | --- |
| Kimlik türü | **Asıl öğe kimliği** | **Kelime adayı kimliği** |
| Aynı adres alanı | **36** | **#306** `"C:WserslASUS"` · **#307** `"TUFXDocumentsl"` |
| Aralık (bu istek) | ≤ ~250 | **#251 – #528** |

Ek olarak OCR yolu **bozuk** okumuş (`\U`→`W`, `\D`→`X`, `\`→`l`): `C:\Users\ASUS TUF\Documents` →
`C:WserslASUS TUFXDocumentsl`. Bu yüzden 1.9.110'da eklenen **metinle kurtarma** da tutmuyor
(`users` ↔ `wsersl`, `documents` ↔ `tufxdocumentsl` bulanık kuralları tetiklemiyor). Sorun metin değil,
**numara**ydı.

## Düzeltmeler

1. **Görüntü rozeti çözümlemesi (`openrouter.ts`)**: modelin numarası aday listesinde yoksa **ve** istek
   gerçekten **marked** bir görüntü taşıyorsa, numara **aynı karenin öğelerinde** aranır ve bulunursa hedef
   kabul edilir. Sınırlar: yalnız `scan.image.marked === true` (görüntüsüz/plain istekte ret aynen kalır) ·
   yalnız geçerli kutusu olan öğeler · `condition` dışı türler.
2. **Çok kelimeli OCR satırında merkeze düşme yok**: rozet bir OCR satırına çözülürse **kelime indeksi
   verilmez**; kelimeyi ajanın **mevcut kısa ikinci kelime seçimi** belirler ve tıklama **gerçek kelime
   kutusuna** gider (o mekanizma değiştirilmedi).
3. **Numara sistemleri kanıtta birleşti**: her rozet çözümlemesi günlüğe ayrı satır yazılır —
   `GORUNTU-ROZETI id=… | donen-id=36 listede YOK ama marked goruntude #36 "…" | cok-kelimeli=evet (kisa
   ikinci kelime secimine gidiyor)` — böylece hangi numaranın hangi yolla çözüldüğü kanıtlıdır.
4. **`plain/marked` artık dürüst (`a11y-bridge.ts`)**: köprü, görüntüye rozet çizildiyse görüntü nesnesine
   `marked: true` koyar; gönderim özeti bunu yazar. (Yalnız **etiket**; görüntü alma/okuma davranışı
   değişmedi.) Önceki sürümde özet her zaman `plain` yazıyordu ve **yanıltıcıydı**; gerçek dosya
   (`gonderilen-goruntu.jpg`) numaralıydı.

## Doğrulama

Yeni `tests/badge-id-resolution.test.ts` **4/4**: görüntüsüz istekte **aynı küçük numara reddedilir**
(`rejected='absent'`, `id=null`, rozet satırı yok) · **plain** görüntüde de reddedilir (çözümleme yalnız
marked'a bağlı) · **marked** görüntüde rozet numarası **doğru OCR satırına** çözülür ve **kelime indeksi
verilmez** (satır merkezi DEĞİL; kelime kutusu `refineWordTarget` ile doğrulanır) · tek kelimeli UIA
kontrolü rozetten **kendi kutusuna** çözülür.

Geçit: `typecheck` 0 · Vitest **114 dosya / 860 geçti / 0 kırmızı** · beş Node paketi + `test:lock` 0 kırmızı.

## Sınırlar

- **Canlı Blender denemesi YAPILMADI**: gerçek fare/klavye gerektirir ve §18 güvenlik kapısı masaüstüne
  60 saniyedir dokunulmamış olmasını şart koşar. Doğrulama için adres adımı yeniden çalıştırılmalı ve
  **SUCCESS satırı değil**, alanın **odaklandığı** ve yazılan yolun **o alana girdiği** okunmalıdır.
- Rozet çözümlemesi "aynı kare" varsayımına dayanır: `marked` bayrağı görüntünün çizildiği kareyi
  tanımlar; bayrak taşınmayan (eski/biçimsiz) görüntülerde çözümleme **devre dışı** kalır ve ret sürer.
- Listeye **alınmamış** (aday sınırı) numaralar için davranış değişmedi: `not-listed` olarak raporlanır.
- GLM görsel yolu, akış JSON'u ve kısa ikinci kelime seçimi **değiştirilmedi**.
