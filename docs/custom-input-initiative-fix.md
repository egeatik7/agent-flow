# Yazı alanı ve inisiyatif düzeltmelerinin güncel durumu

1.9.38’deki OCR/kopya eşleştirmesi, kullanıcının açık talebiyle kaldırıldı.
`custom-input.ts`, `probeInput`, gözlem/kopya token’ı ve ilgili testler artık yok.

## Seçilmiş alana yazma

Tıkla → Yazı Yaz (`clearFirst: true`) sırasında geçerli pencere içi nokta varsa,
worker alan içeriğini OCR ile karşılaştırmadan Ctrl+A → Delete → yazma yapar.
Boş alan, farklı dosya adı ve Tk’nin 1×1 yardımcı caret’i bu yolu engellemez.
Önceki içeriği Ctrl+C ile okuma da bu yolda yoktur.

Aktif pencere kimliği/PID/yerleşim, klavye odağı, tıklanan noktanın hedef pencere
ve native odak sınırlarında olması, örtülme, devre dışı ve bilinen salt okunur/
düğme odağı kontrolleri korunur. Bunlar içerik eşleştirmesi değildir.

Okunabilen standart alanlarda mevcut native/UIA son-değer kontrolü korunur.
Custom alanda değer okunamıyorsa komut gönderildi olarak raporlanır; doğrulanmış
başarı veya kalıcı hedef hafızası sayılmaz. Enter istenmişse aynı odakta bir kez
iletilir. Noktasız Yazı Yaz ve ekleme modu mevcut yollarını kullanır.

Büyük bir Tk container’ının sınırları tek tek alan kimliğini kanıtlamaz. Bu yol,
kullanıcının tıklamayla seçtiği alanı esas alır; yanlış hedef tıklaması yanlış
alana yazmaya yol açabilir. Modelin hedef seçimine evrensel doğruluk garantisi yok.

## Fare hareketi

`moveAt`, gerçekte olmayan `XpWin.SetCursorPos` yerine `common.ps1` içinde zaten
bildirilmiş `XpNative.SetCursorPos` kullanır. Hareket tıklama üretmez.
Native API false dönerse hareket başarısızdır; hover/current-click kontrolleri
korunur. Test artık gerçek C# bildiriminin public/static/bool imzasını da denetler;
taklit sınıfa olmayan metot ekleyerek bu hatayı gizlemez.

## Korunan inisiyatif davranışı

1.9.38’deki sınırlı görev prompt’u, görsel tek tıklama öncesi move → yeni kare →
click_current ve geçersiz model JSON’unun alternatif modele gitmesi korunur.
İkinci bir LLM tamamlanma kontrolü eklenmedi; kullanıcı akışları değiştirilmedi.

## Canlı Windows kabul denemesi

1. Eski EXE’yi kapat, bu kaynaklardan derlenmiş yeni sürümü aç.
2. Görsel isimlendiricide alanı doğru tıklayan node ardından Yazı Yaz çalıştır.
   Önce başka yol yazılıyken, sonra kutu boşken dene. İçerik silinip istenen yol
   yazılmalı; OCR/kopya eşleştirme mesajı olmamalı.
3. İnisiyatifte move ve click_current dene. Fare gerçekten hareket etmeli;
   SetCursorPos missing-method hatası olmamalı.
4. Yazma sırasında başka pencereye geçme/fokus değişimi denemesinde sonraki
   yazma ve Enter hedef dışına gönderilmemeli.

Bu Linux incelemesi gerçek Windows fare/klavye/clipboard oturumu değildir.
PowerShell testlerinde üretim fonksiyonları yürütülür, işletim sistemi sınırları
kaydedici taklitlerdir. Üretilmiş Windows EXE veya canlı model testi iddia edilmez.
