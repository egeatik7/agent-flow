# Durma kapıları kataloğu (F7, yalnız analiz)

Tarih: 17 Ekim 2026 · Sürüm: 1.9.151 (`c789421`) · Kod değişikliği YOK.

Kaynak: `electron/agent.ts` (48 satır), `electron/runner.ts` (45 satır), `a11y/worker.ps1` (66 satır) — `throw` içeren satırların sayımı.

## Ölçüt (CLAUDE.md §19)

Her kapı için tek soru: **"Bu kapı, kullanıcının istediği işi belirsizlik yüzünden mi engelliyor, yoksa işin gerçekten yapılamayacağını mı söylüyor?"**

- **Belirsizlik** (tahmin, odak, "emin değilim"): uyarıya dönmeli ya da kalkmalı.
- **Gerçek imkânsızlık / kapsam / bozukluk**: kalmalı (kapanmış pencere, başka süreç, Nubbo'nun kendi penceresi, Durdur, boş hedef, eksik API anahtarı, bozuk node, sözdizimi, worker betik hatası).
- **Tekrar koruması** (aynı yan etkili eylemin ikinci kez gönderilmesi, CLAUDE.md §8): ayrı bir sınıf; kalmalı ama mesajı "neden tekrar edilmedi" diye açıklamalı.

Öneri sütunu Haiku'nun önerisidir. **Satır satır onay kullanıcıdadır**; hiçbir kapı bu belgeye bakılarak değiştirilmez (F7b).

## 1. Worker (a11y/worker.ps1) — INPUT_* kodları

| Grup | Satırlar | Ne söylüyor | Soru yanıtı | Öneri |
| --- | --- | --- | --- | --- |
| Odak değişti / kimliği doğrulanamadı | 981, 982, 985, 991, 992, 1042, 1323 | Klavye odağı değişti, yazma kimliği eşleşmiyor | Belirsizlik | Uyarıya dönsün (tekrar gönderme yok) |
| Odak tahmini (kendi yazmasını doğrulayamama) | 1030 (READBACK), 1046, 1047 | Yazılan metin okunamadı / odak devre dışı | Belirsizlik | Uyarıya dönsün |
| Alan türü tahmini | 1040 (READ_ONLY), 1041 (NOT_FIELD) | Seçilen öğe salt okunur ya da alan değil | Belirsizlik (UIA'ya göre) | Uyarıya dönsün |
| Tıklama kapalı / bayatlamış | 721 (CLICK_OCCLUDED), 859 (LAYOUT_CHANGED), 1045 (TARGET_UNRESOLVED) | Üstte başka öğe, pencere değişmiş, nokta alanda değil | Belirsizlik | Uyarıya dönsün; "bayat koordinat kullanılmadı" mesajı kalsın |
| Pencere etkin değil (tuş/yazma) | 821, 830, 854, 890, 895 | Hedef öne gelmedi / başka program önde | Belirsizlik | Uyarıya dönsün (CLAUDE.md §19 örneği) |
| Yazma sonucu belirsiz | 746 (WRITE_UNCERTAIN), 1122 (MOVE_FAILED) | Yazma gitti mi bilinmiyor | Belirsizlik + tekrar riski | Uyarıya dönsün; **otomatik tekrar yok** |
| Doğrudan değiştirme gerekli | 1240 (DIRECT_REPLACEMENT_REQUIRED), 1328 (CUSTOM_APPEND_UNSUPPORTED) | Alan yalnız tam değiştirme kabul ediyor | Kapsam | Kalsın (yapılamayan iş) |
| Yazı Yaz seçimi değişti | 1253, 1256, 1259, 1300, 1302 | Seçilen alan kapandı / öndeki pencere değişti | Belirsizlik | Uyarıya dönsün (yazma gönderilmez) |
| Hedef pencere kapandı / başka süreç | 816, 836, 871 | Kimlik uyuşmuyor | Gerçek imkânsızlık | **Kalsın** |
| Hedef bilgisi eksik / görünmüyor | 814, 834, 838, 886, 897, 1037 | Pencere kimliği yok, görünür alan yok | Gerçek imkânsızlık | **Kalsın** |
| Nubbo'nun kendi penceresi | 889, 1098, 1134, 1193, 1441, 1537 | Nubbo kendi penceresine yazmaz/tıklamaz | Kapsam kuralı | **Kalsın** (CLAUDE.md §19 istisnası) |
| Sözdizimi (tuş dizisi) | 133, 136, 157, 167, 178, 211, 241, 256, 331, 333, 337, 339 | Tuş tanınmadı, parantez hatalı | Sözdizimi | **Kalsın** |
| Tıklama modu geçersiz | 1086 | Geçersiz mod | Bozukluk | **Kalsın** |
| Ekran dışı bölge | 1171 | İstenen bölge masaüstü dışında | Gerçek imkânsızlık | **Kalsın** |
| Pano / kopyala-yapıştır | 1203, 1382 | Pano metni kabul etmedi | Teknik engel | **Kalsın**; açık mesaj var |
| Worker betik hatası | 406, default `UNKNOWN_OP` (1543), 1461 (yeniden fırlatma) | Betik bozuk / bilinmeyen işlem | Bozukluk | **Kalsın** |
| Girdi gönderilemedi | 1285 (INPUT_NOT_SENT) | Worker girdiyi göndermedi | Kapsam/teknik | **Kalsın** |

## 2. Agent (electron/agent.ts)

| Satır | Ne söylüyor | Soru yanıtı | Öneri |
| --- | --- | --- | --- |
| 463 | Masaüstü kısayolu istendi, hedef görev çubuğunda bulundu; tıklama yok | Belirsizlik (yanlış hedef riski) | Karar: uyarıya çevrilsin mi |
| 783, 784, 801, 875, 893 | Popup kapatma: ikinci kapatma yok, nokta geçersiz, girdi başarısız | Tekrar koruması + belirsizlik | Kalsın; mesaj açık |
| 1203, 1210 | Ekran kilitli / konum onayından sonra kilitlendi | Bekleme var; bu kapı bekledikten sonra gelir | Kalsın (bekleme sonrası) |
| 1226, 1231, 1235 | Görsel onay ve kalan yöntemler sonuç vermedi | Gerçek bulunamadı | Kalsın; kurtarma kapısı |
| 728 | Bütün hedef yöntemleri bitti | Gerçek bulunamadı | Kalsın |
| 1326 | Fare konumu okunamadı; girdi yok | Belirsizlik (okuma hatası) | Uyarıya dönsün |
| 738, 748, 768 | Görsel mod için hedef yazılmamış / API anahtarı yok / ekran görüntüsü alınamadı | Eksik ayar / bozukluk | Kalsın |
| 1470, 1486, 1506, 1510 | Tuş boş, node uyumsuz, koşul metni yok, koşul için API yok | Eksik ayar / bütünlük | Kalsın |
| 1539 | Koşul yöntemlerinin hiçbiri karar veremedi | Belirsizlik | Karar: uyarıya çevrilsin mi (Koşul'un "yok" çıkışı var) |

## 3. Runner (electron/runner.ts) — akış ve döngü

| Satır | Ne söylüyor | Soru yanıtı | Öneri |
| --- | --- | --- | --- |
| 206, 219, 252, 630, 767 | Paket / döngü / başlangıç / devam öğesi yok | Bütünlük (akış ile kayıt uyuşmuyor) | Kalsın; mesaja "ne yapılmalı" eki (F7c) |
| 222 | Kayıtlı devam öğesi birden fazla satırda | Belirsizlik (hangi satır?) | Kalsın — yanlış satırdan devam etmemek için; karar sende |
| 353, 355, 363, 364, 374 | Eksik ayar, eski node türü, Yap ortamda yok | Eksik ayar / bütünlük | Kalsın |
| 546 | Çıkış bağlı değil | Bütünlük | Kalsın |
| 603, 608 | Klasör okunamadı / klasör yok | Gerçek imkânsızlık | Kalsın |
| 432, 433, 440–442 | Kurtarma vazgeçti / başarısız / çağrı başarısız | Gerçek sonuç | Kalsın |
| 446 | Kurtarma ajanı bağlı değil → koşu durur | Karar verildi (öneri A; 1.9.151) | Değişmez |
| 482, 483 | Adım / tur sınırı aşıldı (sonsuz döngü koruması) | Kapsam koruması | Kalsın; sınır değeri ayrı konu |
| 515, 517 | Kurtarma sonrası yine hata / kurtarma toparlayamadı | Gerçek sonuç | Kalsın |
| 688, 697, 722 | Kutu öğe hatası: döngü durdurulur / aynı hata kümesi tekrar etti | **Öğe politikası** (karar verildi: A) | Değişmez; "aynı hata kümesi" koruması kalsın |

## Özet ve sonraki adım

- Belirsizlik sınıfına düşen ve "uyarıya dönsün" önerilen gruplar: worker'da 9 grup, agent'ta 2–3 kapı, runner'da yok (öğe politikası kararlı).
- Sana sorulacak satırlar (kararın senin): **agent 463**, **agent 1326**, **agent 1539**, **runner 222** (devam belirsizliği), **worker 1253–1302** (Yazı Yaz seçim değişikliği).
- Bu kararlar verilmeden hiçbir kapı kaldırılmaz (F7b, plan §4).
- F7c (durma mesajlarına "ne yapmalı" eki) onay gerektirmeyen, ayrı küçük bir iştir; istenirse yapılır.
