# Sürüm notu — 1.9.31

**İnisiyatif: ikinci bitiş kontrolü kaldırıldı.** Kaynak: kullanıcının `Nubbo_Remove_Finish_Check`
paketi (taban `952a4f9` = 1.9.30; `git apply --check` temiz).

## Değişen
- Görsel İnisiyatif ajanı `finished` dediğinde **artık ikinci bir model son ekranı yargılamıyor**:
  `verifyGoal` (görsel doğrulama çağrısı) ve **iki çağrı yeri** kaldırıldı.
- Kayıtlı İnisiyatif yolu tamamlandığında da aynı ikinci kontrol yok; yol tamamlanınca
  `log('success', …)` yazılır ve `true` döner.
- Reddedilen bitiş sonrası kalan "Eksik kalanı yap" notu, `rejected` sayacı ve gereksiz
  `visionCheck` içe aktarımı kaldırıldı.
- `CLAUDE.md`'ye kullanıcının kararı yazıldı: *görsel ajan finished dediğinde ikinci bir modelle son
  ekranı yargılama yoktur* (bu, §17'deki "sistem başarıyı yargılamaz" kararıyla aynı yöndedir).
- `scripts/test-stability-agent.cjs`'e **3 regresyon testi** eklendi: (1) `finished` ikinci model
  çağrısı olmadan kabul edilir ve görev yeniden kurcalanmaz; (2) profil tıklamasından sonra `finished`
  gelirse profil menüsü **tekrar açılmaz** (tek tıklama); (3) tamamlanmış kayıtlı yol ikinci kontrol
  olmadan döner.

## Değişmeyen
- Genel `screenCheck` ayarı, odak/pencere korumaları, doğrudan Koşul node'ları ve motorun hata
  sınırları **değişmedi**. Model gerçekten `finished` demiyorsa patch ona **zorla başarı vermez**.

## Doğrulanan
- `typecheck` ✓ · `build:main` ✓ · `build:electron` ✓ · `node --test scripts/test-stability-agent.cjs` ✓ ·
  **Vitest** ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Canlı Windows profili denenmedi**: gerçek Chrome profil akışında ilk profile tıklama sonrası
  `finished` geldiğinde ikinci API çağrısı olmadığı ve profil menüsünün tekrar açılmadığı **ölçülmedi**.
  Testler taklit Windows köprüsüyle gerçek agent kodunu çalıştırır; canlı oturum değildir.