# Sürüm notu — 1.9.44

**Tıklamayı LLM seçer; eski "hazırlanmış nokta" modu kaldırıldı.** Kullanıcının açık isteği:
*"Tıklama konusunda LLM seçimi yapmalı, orda eski mode kod olmamalı, gitsin kendi tıklasın nasıl
istiyo üzerine getirip nişan almayı tamamladıktan sonra."*

## Kanıt (1.9.43 gerçek koşu günlüğü)
**Hiç hata yok** — `Fare oynatıldı` satırları var (üstüne tutma **çalışıyor**), ama modelin
`double`'ı gönderildikten sonra tepki *"prior double-click was **not on its icon**"* diyor ve hedef
açılmıyor. Engel artık hata değil, **eski mod kodu**: inisiyatif döngüsü, tıklama "hazırlanmış
nokta" ile eşleşmiyorsa tıklamayı **harekete çeviriyor**, modele *"NOT sent"* diyordu; ayrıca
tıklama beklemedeyken `type/hotkey/drag/scroll` **engelleniyor** ve `finished` **reddediliyordu**.

## Değişen
- **Tıklama dönüşümü kaldırıldı**: model `click`/`double`/`right` gönderdiğinde **olduğu gibi
  uygulanır**; executor tıklama türünü seçmez, tıklamayı harekete çevirmez.
- İmleç kaydı bu noktayla uyuşuyorsa pencere damgası (hwnd) verilir; uyuşmuyorsa tıklama yine
  gönderilir — örtülme ve **kabuk/masaüstü** kontrolünü worker kendi içinde yapar.
- "Önerilen tıklama bekliyor" gerekçesiyle **başka eylemleri engelleme** kaldırıldı.
- `finished` artık bu gerekçeyle **reddedilmiyor** (`CLAUDE.md §17`).
- **Prompt** yeni sözleşmeye göre: *"The click is YOUR choice … the executor never turns your click
  into a move and never picks a click type for you."* — eski *"unprepared click only moves the
  pointer"* metni kaldırıldı; sözleşme cümleleri (`On the NEXT screenshot`, `click_current is
  optional`) korundu, paketin sözleşme testi **gevşetilmeden** geçiyor.

## Doğrulanan
- `typecheck` ✓ · **Vitest 288 test** ✓ · `build:electron` ✓ · beş Node paketi ✓ ·
  `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs` → **63 pass** ✓ ·
  **Windows PowerShell 5.1'de 9 harness hepsi PASS** ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst)
- **Gerçek koşuda tıklamanın artık hedefe gittiği HENÜZ ÖLÇÜLMEDİ.**
- Yazma (Tk/Pane) tarafı hâlâ ele alınmadı. **PowerShell 7 kurulu değil → atlandı.**