# Görsel model zinciri ve bir ek çıktı denemesi

Taban: 1.9.135 / `1849192`.

## Davranış

1. Tıkla'nın Görsel LLM hedefleme ve imleç kontrolü `visionModel / visionBackups` listesini kullanır. Yap node'unun araç döngüsü `agentModel / agentBackups` listesini kullanmaya devam eder. Görsel liste boşsa mevcut Metin Modeli fallback'i korunur. Ayar ipuçları doğru bölüme taşındı. Kayıtlı listeler yeniden yazılmaz; Görsel LLM bölümünün doğru sıra ve yedeklerle kaydedilmiş olması gerekir.
2. A'nın yanıtı reddedilip B hedefi bulursa, aynı görsel işlemde popup, kırpılmış görüntü ve hizalama B ile devam eder. B hizalamada başarısızsa yalnız C ve sonraki yedekler kullanılabilir; C cevap verdikten sonraki düzeltmeler C ile sürer. Yeni node/ayrı görsel işlem güncel kayıtlı öncelik listesinden başlar. Bir işlem sürerken ayar listesi değişse de o işlemin model devam zinciri sabittir. Bu durum yalnız bellekte tutulur, akış JSON'una eklenmez.
3. Motorun reddettiği model çıktısı aynı modele bir ek deneme verir. Bozuk/eksik JSON, geçersiz görsel koordinat veya alan, kesilmiş/boş yanıt, geçersiz kelime ID'si, aday ID–metin çelişkisi ve araç çağrısının biçim/argüman sözleşmesi bu kapsamda. İkinci çıktı da reddedilirse sonraki model denenir. O çağrıda çıktısı iki kez reddedilen modele tekrar dönülmez. `null`, `missing` ve `uncertain` gibi geçerli kararlar bozuk çıktı sayılmaz. Gönderilmiş bir eylem bu ek deneme kapsamında tekrar yürütülmez. HTTP, kredi, kapalı model, erişim ve bağlantı hataları çıktı hatası gibi sınıflandırılmaz; mevcut kuralları korunur. Stop/iptal ve süre sınırı geçerlidir. Günlükte `CIKTI-TEKRAR ... deneme=2/2` görünür.

Yeni logdaki `{"intent":"target","x":168,"syncpointx":484,"y":477,"syncpointy":477}` yanıtı hâlâ reddedilir. Bilinmeyen alanlar silinip koordinat uydurulmaz; modele bir kez daha sorulur. Patch modelin yanlış görsel algısını eğiterek düzeltmez veya her tıklamanın doğruluğunu garanti etmez.

## Model ayarlarının kaydı

Model sırasını değiştirme, silme ve listeden yerel model ekleme doğrudan kaydedilir. Elle yazılan ad Enter veya alandan çıkınca kaydedilir; yarım model adı her tuşta üretim ayarına yazılmaz. Boş bir yedek satırı açmak yalnız düzenleme taslağıdır. Mevcut Kaydet düğmeleri tekrar denemek için kalır. Metin, OCR kelime, Görsel LLM, Yap, Koşul ve Kurtarma listeleri bu davranışı paylaşır.

Her yöntem için arayüzdeki taslaktan ayrı, sunucunun onayladığı **Kayıtlı sıra** gösterilir. Ayar yazmaları sıraya alınır. Eski kayıt cevabı yeni model seçimini veya henüz kaydedilmemiş yeni metni ezemez. Ekranda Kaydediliyor/Kaydedildi/Kaydedilemedi durumu gösterilir. Kurtarma modeline ait kısmi kayıt API anahtarını, izinlerini ve görevini değiştirmez. Sunucudan dönen ayar revizyonu da arayüze taşınır. Yerel sunucu adresi ve üretim ayarları bu otomatik model-sırası kaydına dahil değildir.

## Uygulama — Cursor

Mevcut değişiklikleri koru. Önce:

```sh
git apply --check nubbo-gorsel-model-devam-tekrar.patch
git apply nubbo-gorsel-model-devam-tekrar.patch
```

Çakışma varsa diff'i güncel kodla birleştir; reset/force ile uygulama. Özellikle `electron/openrouter.ts`, `electron/agent.ts` ve `electron/model-chain.ts` güncel değişikliklerle beraber değerlendirilmelidir.

```sh
npx vitest run tests/visual-target.test.ts tests/visual-pointer.test.ts tests/visual-pointer-agent.test.ts tests/model-output-retry.test.ts tests/model-chain.test.ts tests/stage-model-chain.test.ts tests/model-order-live.test.ts tests/condition-target.test.ts tests/target-response.test.ts tests/initiative-scope.test.ts tests/recovery-openrouter.test.ts tests/model-settings-app.test.ts tests/model-chain-commit.test.ts tests/settings-patch.test.ts tests/recovery-ui.test.ts
npm run typecheck
npm run build:electron
node --test scripts/test-targeting.cjs scripts/test-stability-agent.cjs
```

Canlı Windows/Ollama testinde günlük zinciri `kaynak=Görsel LLM` olmalı. A bozuk çıktı → A ek deneme → B başarılı hedef → imleç kontrolü B sırasını doğrula. B'nin kontrol cevabı da iki kez bozuksa C'ye geçip sonraki düzeltmede C'de kaldığını doğrula. Bir sonraki node A ile başlamalı. Node JSON'larını, promptları ve model üretim ayarlarını değiştirme; tıklama sonrası yeni bir başarı doğrulaması ekleme.

## Doğrulama

- 15 ilgili Vitest dosyası: 141/141 geçti; unhandled hata yok.
- Typecheck ve Electron kaynak build'i geçti.
- Node targeting/stability-agent: 33 geçti, 9 mevcut skip, 0 başarısız.
- Tam Vitest: 1116 geçti, 4 başarısız, 5 skip. Tam koşu tamamen yeşil değildir. Aynı 4 başarısızlık değişmemiş 1.9.135 tabanında da yeniden üretildi: `badge-id-resolution.test.ts` içindeki 2 mevcut eşleme beklentisi ve Chrome bulunmadığı için `render-overflow-audit.test.ts` içindeki 2 test. Hiçbiri gizlenmedi veya devre dışı bırakılmadı.
- Canlı Windows/Ollama denenmedi. EXE üretilmedi; sürüm ve paket dosyaları değiştirilmedi.
