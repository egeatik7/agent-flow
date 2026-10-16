# Geliştirme döngüsü runbook'u (F1)

Amaç: Nubbo'yu, mevcut araçlarla, kendi kendini sınayarak geliştirmek. Yeni araç yazılmaz; bu belge yalnız var olan script'leri nasıl sırayla kullanacağını anlatır. Ürün içinde otomatik onarım yoktur (CLAUDE.md §17, §20).

## Roller

- **Güçlü model**: hipotez kurar, senaryo JSON'u yazar, "başarı" tanımını `completed` sınıfına göre verir, kanıt paketini inceler.
- **Orta model (Haiku)**: senaryoyu koşturur, hatayı kanıtla eşleştirir, en küçük düzeltmeyi yapar, kanıtı toplar.

## Kanıt sınıfları (CLAUDE.md §18)

Yalnız `completed` başarıdır. Diğerleri ara sinyaldir:

| Sınıf | Anlamı |
| --- | --- |
| `tool-answered` | Kapı (araç) cevap verdi |
| `input-sent` | Motor yazdığı alanı geri okudu |
| `observed` | Adım, hata veya resmî sonuç görüldü |
| `completed` | Diskte beklenen dosya/bayt var, ya da pencerede beklenen başlık |

## Komut zinciri

Her adım sırayla. Önceki adım başarısızsa sonrakini çalıştırma.

1. **Durum** (salt okunur, ekrana dokunmaz):
   `node scripts/dev-status.cjs test`
   Dal, kirli ağaç, uç nokta build damgası, son senaryo kararları.

2. **Fikstür** (yalnız test profili, uygulamayı kapatır):
   `node scripts/dev-seed-fixture.cjs test`
   Sabit kimlikli paket: `fixture-package` içinde `fixture-inner-type`, `fixture-inner-key`, `fixture-inner-wait`.

3. **Test örneği** (eski jetonu kapatır, yeni exe'yi kapatma sonrası kopyalar, `/health` bekler):
   `node scripts/dev-start-test.cjs test`

4. **Senaryo** (masaüstüne dokunur, bu yüzden `dev-safe` kapısından geçer; çıkış 4 = kapı reddetti):
   `node scripts/dev-safe.cjs -- node scripts/dev-scenario.cjs scripts/scenarios/<ad>.json`
   Senaryolar: `package-inner`, `pilot-temp-file`, `region-bounded`, `ui-local`, `ui-real`, `ui-typing`.

5. **Kanıt**: `test-artifacts/<ad>-<zaman>/` içinde `evidence.md`, senaryo, kontroller, motor günlüğü, `run.report`, hata görüntüsü.

## Düzeltme kuralları

- Bir hipotez için en fazla **3 düzeltme denemesi**. Her deneme: değişiklik → typecheck → ilgili test → senaryo → `evidence.md` farkı.
- Üçüncü denemeden sonra hâlâ `completed` değilse dur. Kanıt paketini (`evidence.md`, motor günlüğü, hata görüntüsü, denenen değişiklikler) güçlü modele devret.
- Kırmızı test tek başına durma sebebi değildir; not olarak yazılır (CLAUDE.md §19). Ama senaryo `completed` değilse iş ilerlemiş sayılmaz.
- Kullanıcının gerçek akışına, gerçek profil deposuna ve açık tuvaline dokunulmaz (CLAUDE.md §18). Koşular yalnız `NUBBO_PROFILE=test` ile.
- `dev-safe` reddederse `--yes` verilmez. Kullanıcıya bildir ve bekle.

## Kanıt paketi şablonu

Güçlü modele devredilecek paket, `test-artifacts/<ad>-<zaman>/` klasörü ve şu üç satır:

- Hipotez: …
- Denenen düzeltmeler (en fazla 3): …
- Hâlâ bozuk (kanıt yolu): …

## Kabul

Komutlar bu repodaki script'lerin gerçek kullanım satırlarıyla eşleşiyor (`scripts/dev-status.cjs`, `dev-seed-fixture.cjs`, `dev-start-test.cjs`, `dev-scenario.cjs`, `dev-safe.cjs`). Senaryo adları `scripts/scenarios/` klasöründen alındı. Bu dosya kanıt üretmez; sadece süreci tarif eder.
