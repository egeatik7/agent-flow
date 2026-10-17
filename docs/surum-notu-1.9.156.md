# Sürüm notu — 1.9.156

**Taban:** `a9b9de3` (1.9.155).

## Ne değişti

- **AI grubu koruması.** Test oturumunda otomatik merge yalnız `AI` grubundaki tuvallerde yapılır. Başka bir gruptaki tuval reddedilir ve hiçbir şey yazılmaz. (`src/App.tsx`, `agentGraphHandler`.)
- Ortak kütüphanede `AI.zip` grubu oluşturuldu (boş). Kullanıcının `Nubbo_Son_Dongu_Kosul_Guncellenmis.zip` dosyası değişmedi.
- CLAUDE.md §21'e kural eklendi.

## Henüz yok

- AI dışındaki bir tuvali AI grubuna kopyalayıp orada çalışma adımı. Şu an böyle bir tuval reddedilir.

## Bilinen

- `zip-library-storage` testi (EPERM, Windows dosya kilidi) bu koşularda 2 kez üst üste kırmızı çıktı. Kod değişmedi; kullanıcı kararıyla kabul edilmiş kararsız test.
- Pencere tarafı birim testiyle değil, tip kontrolü ve canlı denemeyle doğrulanır; canlı deneme için AI grubunda tuval gerekir.
