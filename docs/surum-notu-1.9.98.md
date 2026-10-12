# Sürüm notu — 1.9.98 (Koşul artık her zaman modele sorar; "Ekrandan Seç" koşuldan kalktı)

**Kaynak**: kullanıcının açık isteği (patch paketi değil). Önceki koşul sözleşmesi — "tırnaklı = yerel kesin metin,
tırnaksız = tarif" — bu sürümde **geçersiz kılındı**.

## Kullanıcının istediği (birebir)

> "tırnaklı tam eşleşme llm'siz hiçbir şey istemiyorum, ekrandan seç de kalksın. her şeye llm baksın istiyorum.
> o koşul kutusunda ne aradığımı da bam diye kutuya yazcam. tırnak falan yok. hangi pencerede aradığımı da yazcam
> ama hepsinin seçimini llm yapacak. bu şekilde değiştirelim nodeyi ve yöntemler sekmesini."

## Yapılanlar

1. **Tırnaklı "kesin metin" ve yerel tam-metin eşleşmesi koşuldan tamamen kaldırıldı** (`electron/agent.ts`).
   Koşul kutusundaki metin artık **her zaman düz cümle tariftir** ve kararı **metin modeli** verir.
2. **Aşama sırası korundu:** her turda önce **UIA** okuması (`conditionUia` promptu), açık kanıt yoksa **birleşik
   Windows + ONNX OCR** (`conditionOcr` promptu). İki aşama da kanıt bulamazsa koşul **"yok"**.
3. **Pencere alanı korundu ve kullanıcı yazıyor:** `conditionWindow` + `conditionWindowMatch`. Önce o pencereye
   bakılır; pencere yok/başlığı belirsizse bir kez tüm ekrana geçilir ve **bağlamı da model değerlendirir**
   (başka uygulamanın durumu kanıt sayılmaz).
4. **"Ekrandan Seç" ve "İmleçle Yakala" koşuldan kaldırıldı** (`src/components/SidePanel.tsx`, `src/App.tsx`).
   Tıkla / Yazı Yaz / Yap node'larının seçim davranışı **aynen** kalır.
   - **Eski kayıtlı akışlar bozulmaz:** koşulda kayıtlı bir öğe (`locator`) varsa ve kutu boşsa motor yolu korunur;
     panel bu durumda yalnız **"Eski seçimi temizle"** sunar.
5. **Yeni hata metinleri:** kutu boşsa *"…: koşul için ne aradığını yaz."*; model yoksa *"Koşul artık her zaman metin
   modeline sorar; API anahtarı ya da yerel model gerekli."* (koşulda yerel yedek yol yoktur — sessizce yanlış
   "var/yoq" demek yerine açık hata).
6. **Yöntemler → Koşul sekmesi** yeni sözleşmeye göre yazıldı (`src/components/LlmPanel.tsx`): "Seçilmiş yazısız öğe —
   LLM yok" bölümü kaldırıldı; not artık "ne aradığını cümleyle yaz, kararı model verir, tırnak yok" diyor;
   `conditionUia` / `conditionOcr` promptları korunuyor.
7. **Kullanıcı metinleri:** README'nin koşul maddesi düzeltildi; `docs/surum-notu-1.9.52.md` içindeki eski tırnak
   tablosu "1.9.98'de geçersiz" notuyla işaretlendi; `docs/CONDITION-METHODS-PROGRESS.md` içine **Tur 4** bölümü
   eklendi; `src/manual/tips.ts` ipuçlarından tırnak/yerel arama ifadeleri çıkarıldı.

## Değişmeyen güvenceler

- Koşul **masaüstüne dokunmaz**: tıklama, yazma, tuş, odak değiştirme, pencereyi öne getirme yok; görsel modele ekran
  görüntüsü gönderilmez.
- Süre: `0` = tek tur; süre verilirse en çok 700 ms aralıkla tekrar bakılır; süre dolunca **"yok"** çıkışı kullanılır
  (bağlı değilse süreli durumda açık hata, süresiz durumda uyarı + tamamlanmamış koşu).
- Ölçüm turu kuralı: geç gelen okuma/model sonucu dal değiştirmez, kuyruktaki okuma gönderilmez, iptal yeni model
  çağrısı doğurmaz.

## Doğrulama

- `typecheck` ✓ (üç proje) · **Vitest 113 dosya / 871 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.97 tabanı 111/857 → **+2 dosya / +14 test**).
- Koşul sözleşmesi testleri: `tests/condition-target.test.ts` **28/28** ✓ (eski "tırnaklı → yerel" iddiaları
  yeni sözleşmeye bilinçli olarak çevrildi) + yeni `tests/fix-tur4-condition.test.ts` **5/5** ✓
  (UIA ve OCR aşamalarında model, tırnak artık kısayol değil, boş kutu hatası, modelsiz açık hata, pencere bağlamı).
- Arayüz: yeni `tests/fix-tur4-ui.test.ts` **9/9** ✓ (koşulda seçim düğmeleri yok, eski seçimi temizleme çalışıyor,
  koşula seçim yazılmıyor + uyarı düşüyor, Tıkla/Yazı Yaz seçimleri duruyor).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability **40** (+9 atlandı), lock 1; **hepsi 0 kırmızı**. **On bir PS 5.1 harness'i** exit 0 ✓.
- `git diff --check` temiz ✓.
- Not: `scripts/test-stability-agent.cjs` içindeki iki eski koşul testi (tırnaklı yerel yolla modelsiz koşan)
  yeni sözleşmeye **bilinçli olarak** çevrildi (artık sahte modelle koşuyor ve "eski kayıtlı öğe kullanılmaz"
  kuralını ölçüyor); kayıtlı öğeli (kutusu boş) eski akış testi de "canlı UIA kimliği, salt okunur,
  model çağrılmaz, ekran taraması açılmaz" biçiminde sıkılaştırıldı.

## Bilinçli sınır ve maliyet notu

- Koşul artık **her turda en az bir, gerektiğinde iki model çağrısı** yapar (UIA + OCR aşamaları). Uzun süreli
  beklemelerde bu maliyet kullanıcının açık tercihidir; süre alanını gereğinden uzun tutmamak gerekir.
- Başlamış **native ONNX** okuması zorla durdurulamaz; süre dolunca koşul döner ve o geç sonuç kullanılmaz.
- Canlı Windows UIA/OCR, fiziksel masaüstü ve tablet bu derlemede de sınanmadı.
