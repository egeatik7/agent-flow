# Sürüm notu — 1.9.34

**Arayüz temizliği + test için CLI ayrımı.** Kaynak: kullanıcının `Nubbo_UI_Cleanup` paketi
(`git apply --check` temiz; paketin yazdığı taban 1.9.32, uygulandığı yer 1.9.33).

## Kaldırılan (kullanıcı kararı)
- **Ajan tavsiyeleri paneli** ve `src/components/BranchPanel.tsx`.
- **Öneri inceleme tuvali**, banner, kesikli değişiklik işaretleri ve **pencereye öneri gösterme /
  merge transportu**. Eski `branch.show` veya uygulamalı merge çağrısı artık kullanıcı tuvaline
  erişmez; **askıda kalmak yerine açık ret** verir (başarı gibi gösterilmez).
- Kullanıcı arayüzünden **CLI katalog/tek adım/önizleme/akış-durum/izin/token/endpoint** kontrolleri
  ve eski yardım açıklamaları.

## Korunan
- **Ajan sekmesi** ve mevcut **ekran değerlendirme ayarı**; Node/LLM/Ayarlar sekmeleri ve
  model/API ayarları.
- **CLI araç motoru ve branch düzenleme/veri kodu içeride** duruyor (mevcut test senaryoları için).
- Normal akış motoru, node anlamları, OCR/hedef bulma, tuş/yazma davranışı ve **döngü hata politikası**
  değişmedi; eski kayıtlar topluca silinmedi.
- Token, izin, odak/pencere ve durdurma korumaları gevşetilmedi; izin modu kendiliğinden `auto` olmaz.

## Yeni güvence: test araç kapısı
- CLI/HTTP araçları yalnız **hem** ayrı profil (`NUBBO_PROFILE`) **hem** `NUBBO_TEST_TOOLS=1` verilmiş
  oturumda kullanılabilir. Eski `agentEndpoint=true` ayarı **tek başına yetmez**.
- `scripts/dev-start-test.cjs` test örneğine bu iki değişkeni verir. Kapı testi:
  `tests/test-tools-gate.test.ts`.
- Ayrıntılı test başlatma açıklaması: `docs/sade-urun-test-cli.md`.

## Doğrulanan
- `typecheck` ✓ · Vitest ✓ · `build:electron` ✓ · `node --check scripts/dev-start-test.cjs` ✓ ·
  `node --test scripts/test-stability-main.cjs` ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Gerçek Windows arayüzü ve test HTTP uç noktası bu oturumda çalıştırılmadı**: panellerin
  kalktığı gözle görülmedi, test profilinin iki değişkenle açıldığı canlı sınanmadı.