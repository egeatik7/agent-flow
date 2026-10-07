# Sürüm notu — 1.9.37

**Fare oynatma / oradan tıklama: uçtan uca düzeltme.** Kaynak: kullanıcının `Nubbo_Hover_Fix` paketi
(`git apply --check` temiz; taban 1.9.36).

## Değişen
- **İmleç işareti yalnız modele giden kopyaya çizilir**: `agentShot → bridge.scan → Invoke-Scan`
  zinciri bir `cursorMarker` seçeneği taşır. **OCR/ONNX/imza, normal tarayıcı görüntüsü ve
  şablon/patch arama kareleri temiz kalır** (1.9.35'te işaret ham yakalama yoluna çiziliyordu ve
  OCR'ı kirletme riski vardı).
- **Koşu başı temizliği**: `beginRun` eski hover kaydını siler; fareyi taşımayan diğer giriş
  eylemleri kaydı geçersiz kılar. "Fareyi Oynat" node'u → ekran inisiyatifinde `click_current`
  zinciri **aynı taze kaydı** kullanır.
- **Liste inisiyatifi `move`'u gerçekten yürütür** (gerçek aday id'siyle) ve **tıklamaz**; liste
  arabirimine koordinatsız `click_current` **eklenmedi**.
- **Durdurma güvenliği**: durdurma sonrası gecikmiş bir imleç cevabı **tıklama üretemez**.
- **Pencere kimliği zorunlu**: hover penceresi bilinmiyorsa tıklama reddedilir (`INPUT_CLICK_STALE`).
- **Worker yürütme anında imleci yeniden ölçer** (çağırandan gelen okuma bayatlamış olabilir);
  3 px'den fazla sapma → tıklama yok.
- **Taşıma API'si başarısızsa hata döner** (`INPUT_MOVE_FAILED`) — sessizce "gidildi" denmez.
- `SCREEN_PROMPT`'taki işaret açıklaması **koşulludur**; işaret uygulamanın kendi kontrolü değildir.
  **Kayıtlı özel promptlar korunur.**

## Doğrulanan
- `typecheck` ✓ · **Vitest** ✓ (yeni `tests/list-move-action.test.ts` dahil) · `build:electron` ✓ ·
  `node --test scripts/test-stability-agent.cjs scripts/test-input-recovery.cjs` ✓ (paketin
  **eski kodda kırılan, düzeltmeyle geçen** dört yeni üretim-ajanı regresyonu dahil) ·
  `scripts/test-cursor-frame.ps1` ✓ · `scripts/test-hover-worker.ps1` ✓ · `scripts/test-worker.ps1` ✓ ·
  `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Gerçek Windows masaüstü girdisi, gerçek GDI işaret çizimi ve Windows PowerShell 5.1 denenmedi.**
  PowerShell kontrolleri **gerçek üretim gövdelerini** çalıştırır ama OS/GDI/fare enjeksiyonları
  taklittir. Yeni `docs/hover-duzeltmeleri.md` bu işin ayrıntısını anlatır.