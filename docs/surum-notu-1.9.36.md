# Sürüm notu — 1.9.36

**1.9.35'in kalan tutarsızlığı kapatıldı.**

Kimlik listesiyle çalışan JSON yolundan `move` **çıkarılmıştı** (yürütme kodu ayrı iş; yarım özellik
bırakılmadı) ama o yolun promptundaki iki açıklama satırı satır-sonu farkı yüzünden **silinememişti**.
Sonuç: model, o yolda **var olmayan** bir eylemi öğreniyordu — kullanıcının 1. maddesindeki hatanın
aynı sınıfı. Bu iki satır kaldırıldı.

- Koordinatlı yol (Luna / ekran görüntüsü) `move` + `click_current` öğretmeye **devam ediyor** ve
  orada gerçekten çalışıyor (1.9.35).
- Kimlik listesi yolu artık yalnız desteklediği eylemleri listeliyor: click, double, right, type,
  key, wait, done, fail.

Doğrulanan: `typecheck` ✓ · 275 Vitest ✓ · `pack:win` ✓. Canlı Windows yine denenmedi.