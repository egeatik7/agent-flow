# Sürüm notu — 1.9.68 (Kurtarma Ajanı)

Kaynak: `Nubbo-Kurtarma-Ajani-1.9.62` paketi ✓. `KURULUM.txt`: **`agent-flow-update.patch`** → önceki
**`38d4be6`** XP/Navigator sürümüne ✓ (benim `38abbe0` = aynı içerik ✓, 1.9.67 ✓); `cumulative` → `6edcdcc` ✓.

## Uygulama yöntemi (dürüst kayıt)
`update` patch'inin düz `--check`'i **`package.json` + `package-lock.json`** yüzünden **başarısız** ✗ —
ölçtüm ✓: o iki dosyada **tek fark sürüm satırı** ✓ (1.9.61 → **1.9.62** ✗); **script/bağımlılık değişikliği
YOK** ✓ (klasördeki `package.json`'ın script listesi benimkiyle **aynı** ✓). Bu yüzden o iki dosyayı
**hariç tutarak** uyguladım ✓ (`git apply --exclude=package.json --exclude=package-lock.json` ✓,
`--check` paketsiz = **0** ✓) ve **kendi numaralandırmamı** korudum ✗ (1.9.68 ✓) — **zorlama yok** ✗.

## Gelen — Kurtarma Ajanı
- **Ayarlar → Kurtarma Ajanı** ✓ (`src/components/RecoverySettingsPanel.tsx` ✓ + `SidePanel.tsx` ✓):
  **model** ve **görev açıklaması** girilir ✓; **ekran eylemleri / node çağırma yetkileri** seçilir ✓;
  **hata veren node dışındaki ek eylem node'ları** işaretlenebilir ✓; **Kurtarmayı etkinleştir** +
  **Kurtarma Ayarlarını Kaydet** ✓.
- **İnisiyatif, Koşul, Paket ve Döngü node'ları ajana AÇIK DEĞİL** ✗ (kapsam kilidi ✓).
- **Raporlar aynı sekmede okunur** ✓ + **Rapor klasörünü aç** düğmesi kayıtları açar ✓.
- Motor tarafı ✓: `electron/recovery.ts` ✓, `electron/recovery-runtime.ts` ✓,
  `electron/recovery-settings.ts` ✓ + `electron/agent.ts` ✓, `runner.ts` ✓, `tool-state.ts` ✓,
  `openrouter.ts` ✓, `graph-types.ts` ✓, `types.ts` ✓, `main.ts`/`preload.ts` ✓, `src/styles/xp.css` ✓.
- **Belge** ✓: `docs/kurtarma-ajani.md` ✓ + `README.md` güncellendi ✓.
- **Yeni testler** ✓: `tests/recovery.test.ts` ✓, `recovery-runtime.test.ts` ✓, `recovery-ui.test.ts` ✓,
  `recovery-openrouter.test.ts` ✓.

## Doğrulama — paketin kaynağıyla birebir
- **16/16 dosya «İÇERİK AYNI»** ✓ (satır sonu normalize ✓; fark **0** ✓, eksik **0** ✓) — `agent.ts` ✓,
  `runner.ts` ✓, `recovery*.ts` ✓, `RecoverySettingsPanel.tsx` ✓, `SidePanel.tsx` ✓, `xp.css` ✓,
  `graph-types.ts` ✓, `types.ts` ✓, `main.ts`/`preload.ts` ✓, `README.md` ✓, `kurtarma-ajani.md` ✓.
- **`package.json`: tek fark sürüm satırı** ✓ (ölçüldü ✓) — başka hiçbir satır farklı **değil** ✓.
- `typecheck` ✓ · `build:electron` ✓ · **Vitest 73 dosya / 546 test** ✓ (paketin 541'i + Windows'a bağlı
  5 atlamanın tamamı ✓) · **beş npm paketi** ✓ · **sekiz Node regresyon dosyası 117/0** ✓ ·
  **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
- **Gerçek Windows/Chrome/Blender/OpenRouter birlikte canlı denenmedi** ✗ (paketin de yazdığı sınır ✓).
- **Kurtarma Ajanı'nın gerçek bir hata koşusunda** devreye girip **onarım önerdiği** denenmedi ✗;
  yetki seçimleri, **ek eylem node'ları** ve **rapor okuma/kayıt klasörü** canlıda görülmedi ✗.
- Paket sürümü **1.9.62** diyor ✗; ben **1.9.68** olarak çıkardım ✓ (numaralandırma bende sürekli ilerliyor ✓).