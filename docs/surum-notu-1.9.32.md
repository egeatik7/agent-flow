# Sürüm notu — 1.9.32

**Yazma / masaüstü / log düzeltmeleri.** Kaynak: kullanıcının `Nubbo_Input_Desktop_Fixes` paketi.
`01_Remove_Finish_Check` ve `Nubbo_All_Fixes` **uygulanmadı**: ikisi de 1.9.31'de alınmış olan
`Remove_Finish_Check` değişikliğini içeriyor ve `git apply --check` bu yüzden başarısız. Paketin
kendi kuralı da "önceki patch zaten uygulanmışsa yalnız 02'yi kullan" diyor. Yalnız
`02_Input_Desktop_Logs.patch` uygulandı (`git apply --check` temiz).

## Değişen
1. **Geometri reddi ayrıştırıldı** (`a11y/worker.ps1`, `Get-VisualInputGeometryRejection`):
   red nedeni tek tek adlandırılır (READ_ONLY, NO_NATIVE_CARET, NON_INPUT_CONTROL,
   CLICK_OUTSIDE_FOCUS, CARET_OUTSIDE_FOCUS, FOCUS_TOO_WIDE/TALL, TK_*).
   **Tk (`TkChild`) için büyük Pane kutusu tek başına ret sebebi değildir**: kendi odak HWND'sine
   ait yerel caret, tıklanan satırla uyum, makul caret boyutu, tıklama/caret kutu içi konumu, doğru
   hedef pencere ve etkin odak şarttır. **Tüm Pane/TkChild alanları koşulsuz yazılabilir ilan edilmez.**
2. **Yazma reddedilirse gerçek ret nedeni, odak kutusu ve caret koordinatları loglanır.**
3. **Konum ifadesi**: "masaüstündeki Google Chrome" gibi ifade görev çubuğu filtresini etkinleştirir;
   genel "masaüstü uygulaması" ifadesi aynı sayılmaz.
4. **Log dürüstlüğü**: OCR doğrudan eşleştirme atlandığında "bütün OCR kapalı" gibi yazılmaz; görsel
   hedefleme yolu her model için "UI-TARS" diye etiketlenmez, gerçek model API logunda kalır.
5. **Paket bitiş node'unun başlığı** doğrulanmış görev sonucu gibi gösterilmez.

## Değişmeyen
- Mevcut döngü hata politikası, akış/node isimleri ve kullanıcı akışları değişmedi.
- Yeni mimari, taşıma (move) eylemi veya otomatik onarım yöneticisi **eklenmedi**.

## Doğrulanan
- `typecheck` ✓ · `build:main` ✓ · `build:electron` ✓ · Vitest ✓ · `test-stability-agent` ✓ ·
  PowerShell geometri ve worker kontrolleri ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Canlı Windows denenmedi**: gerçek Tk alanına yazma, Chrome profil arayüzü ve canlı masaüstü
  girdisi ölçülmedi. Paketin kendi VALIDATION.txt'si de bunu söylüyor.