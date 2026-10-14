# Ayarların otomatik ve kalıcı kaydı

Taban: public main `1849192` / 1.9.135. Paket önceki `nubbo-gorsel-model-devam-tekrar.patch` değişikliklerini de içerir; iki patch'i üst üste zorla uygulamayın. Önceki patch uygulanmışsa Cursor mevcut diff ile birleştirsin. Sürüm numarası değiştirilmedi, commit/push veya Windows EXE üretimi yapılmadı.

## Bulunan yollar ve düzeltmeler

| Bulgu | Sonuç |
| --- | --- |
| Genel, yerel, prompt ve kurtarma alanlarının çoğu yalnız renderer taslağını değiştiriyordu | App'in tek değişiklik yolu tüm değişen alanları otomatik `settings:save` üzerinden mevcut kalıcı electron-store kaydına yazar |
| Model yazma, Enter/blur veya Kaydet gerektiriyordu | Yazma, sıralama, ekleme, silme, seçim ve checkbox değişiklikleri otomatik kaydedilir; Kaydet düğmeleri korunur |
| Yeni adresle katalog alınabiliyor, kaydedilmemiş eski adresle sohbet gönderilebiliyordu | Katalog, API/Görsel Test, canlı sohbet ve çalıştırma bekleyen ayar kayıtlarını boşaltır; yazma başarısızsa eski ayarla başlamaz |
| Eski kayıt yanıtı yeni metni/model seçimini ezebiliyordu | Yazmalar sıralanır, yalnız henüz gönderilmemiş değişiklikler birleştirilir; backend yanıtı raw input metnini değiştirmez |
| Program kapanırken son ayar yazması beklenmiyordu | Kapanış son ayar kaydını bekler; disk hatasında kapanış reddedilir. Yeniden açılış mevcut `settings:get` yolundan kalıcı değerleri alır |
| Kurtarma modeline kısmi kayıt diğer kurtarma alanlarını sıfırlayabiliyordu | Nested partial merge; API anahtarı, izinler ve görev korunur. Başarısız bir kurtarma görevi kaydı sonraki model-only kaydıyla başarılı sayılmaz |
| Yaz promptu Tıkla'nın ortak liste promptunu değiştirebiliyordu | Bağımsız `typeList` alanı; eski özel ortak prompt, kullanıcı Yaz promptunu ayrıca düzenleyene kadar korunur |
| Görsel Test ilk yapılandırılmış modeli, yedek cevap verse bile raporluyordu | Kabul edilen yanıtı veren model callback üzerinden raporlanır |
| Takılma planı görüntü beklerken eski ayar kopyasını tutuyordu | Yeni LLM çağrısından hemen önce güncel zincir, revizyon ve prompt okunur |
| Görsel devam oturumu kullanıcı yeni sıra kaydettiğinde de eski sıralamayı tutuyordu | Yeni sıra sonraki yeni çağrıda uygulanır. Sıra değişmemişse kabul edilen modelin kalan zinciriyle devam edilir |

Geçerli sayı yazılınca otomatik kayıt yapılır. Boş, tamamlanmamış veya aralık dışı sayı önceki geçerli değeri silmez; blur/Enter mevcut aralık doğrulamasını yapar. Metin/prompt girerken boşluk ve satır sonları kaydın normalizasyon yanıtıyla silinmez. Üretim normalizasyonu korunur; arayüzdeki **Kayıtlı sıra** ayrı backend snapshot'ıdır.

Mevcut koşu başında alınan maksimum adım, adım gecikmesi ve pencere küçültme seçenekleri koşunun ortasında yeniden başlatılmaz. Bu alanlar koşu sırasında arayüzde zaten kilitlidir. Model sıraları düzenlenebilir ve sonraki yeni model çağrısında geçerlidir; sürmekte olan isteğin gövdesi değiştirilmez. Native köprü işlemi veya önceden alınmış ekran gözlemi de ayar kaydı için iptal edilmez. Tıklama sonrası yeni doğrulama eklenmedi.

## Cursor'da uygulama

Mevcut değişiklikleri koru; doğru repo/HEAD ve diff'i kontrol et. Taban değişmemişse:

```sh
git apply --check nubbo-tum-ayarlar-otomatik-kayit.patch
git apply nubbo-tum-ayarlar-otomatik-kayit.patch
npm run typecheck
npx vitest run
npm run build:electron
```

Çakışmayı güncel kodla birleştir; reset/force kullanma. Kullanıcının mevcut ayar dosyasını varsayılanlarla değiştirme; node/akış JSON'larını yeniden yazma. Windows'ta uygulamayı aç → modeli ve sunucu/prompt/kurtarma ayarını değiştir → Kaydet'e basmadan programı kapat → aynı profil ile yeniden aç → aynı değerleri doğrula. Yeni EXE ancak bu değişiklikleri gerçekten içeren kaynaktan paketlendiğinde yeni davranışı içerir.

## Doğrulama

- İlgili Vitest: 22 dosya / 173 test geçti; unhandled hata yok.
- Tam Vitest: 1127 geçti, 4 başarısız, 5 skip; unhandled hata yok. Tam koşu yeşil değildir.
- Aynı dört başarısızlık temiz 1.9.135 tabanında ayrıca yeniden üretildi: `badge-id-resolution.test.ts` içinde iki eşleme beklentisi; `render-overflow-audit.test.ts` içinde Chrome bulunamadığından iki gerçek tarayıcı testi. Gizlenmedi veya devre dışı bırakılmadı.
- Typecheck ve renderer + Electron main kaynak build'i geçti.
- Node targeting/stability-agent/stability-main: 38 geçti, 9 mevcut skip, 0 başarısız.
- Otomatik kayıt, gecikmiş yanıt, disk hatası, nested recovery kaydı, test/sohbet öncesi flush, kapanış flush ve yeniden açılış gerçek React bileşenleri + taklit IPC ile test edildi.
- Bu ortam Linux; canlı Windows electron-store profili/Ollama ve yeni EXE ile yeniden açılış denenmedi. Taklit IPC testleri canlı Windows doğrulaması değildir.
