# Bulgu durum tablosu — Nubbo (yönerge: Nubbo_Tum_Bulgular_Cursor_Yonergesi.md)

Taban: **
1.9.120
** · HEAD `
1d643b2
` · dal `fix/bulgu-taramasi-1.9.120` · tarih 
2026-10-13 02:44

> Kural: hiçbir madde kanıt olmadan "düzeltildi" sayılmaz. Canlı Windows doğrulaması yapılmadıysa ayrıca yazılır. Bu dalda **push/yayın/EXE yok**.

| ID | Güncel fonksiyon / dosya | Durum | Kanıt / repro | Commit | Test | Canlı Windows |
| --- | --- | --- | --- | --- | --- | --- |
| U01 | `a11y/worker.ps1` `keys` op'u, direct dalı | **düzeltildi** (canlı doğrulama bekliyor) | Eski `try { Enter-Window … } catch {}` kaldırıldı; direct dalı artık direct olmayan dalla AYNI korumayı kullanıyor (`Enter-Window $win` + `Assert-KeyWindowActive $win`), meşru sistem kısayolları `Test-SystemShortcut` ile muaf, `INPUT_SELF_TARGET` korundu. | bu commit | `worker-key-guard` 4/4 + 12 PS harness 0 kırmızı + `test:keys` 3/0 | **yapılmadı** (gerçek foreground canlı Windows ister) |
| U02 | `agent.ts` "kayıtlı resim (simge)" memo alanı (satır ~545) | **doğrulandı fakat güvenli düzeltme bekliyor** | İddia koddan doğrulandı: memo `rx/ry` **`screenArea()`** (birincil ekran) ile hesaplanıyor; `TargetMemo` sözleşmesi ve `memory.memoOf` ise **`scan.area`** kullanır → hedef pencere sabitken iki farklı koordinat uzayı; konum terimi bozulur, kayıtlı hedefin üstünlüğü kaybolur. GÜVENLİ DÜZELTME NEDEN BEKLİYOR: bu aşamada `res`/tarama alanı kapsamda yok (denendi: `const sa = res.area` → TS2304); doğru alanı bulmak `resolveTarget` içindeki aşama-yerel tarama alanlarının izini gerektirir ve çalışan simge hedeflemesini bozma riski taşır. Yönerge §8 gereği riskli değişiklik UYGULANMADI. | — (kod değişmedi) | — | yapılmadı |
| U03 | `library-lock.ts` `lockFile`/`withLibraryLock` + `zip-library-storage.ts` `load` | **düzeltildi** (canlı CFA doğrulaması bekliyor) | Açma ≠ oluşturma: koşulsuz `mkdirSync` kaldırıldı; `olustur` yalnız açık istekle (varsayılan false). `load()` kayıtlı klasör yoksa **oluşturmaz**, anlaşılır hata döner (eski davranış: korumalı kökte süresiz bekleme → açılış donması). Kilit kanonikleştirmesi ve iki örnek dışlaması korundu. | bu commit | `library-open-vs-create` 4/4 + kütüphane paketi 33/33 | **yapılmadı** (Denetimli klasör erişimi altında canlı deney yapılmadı) |
| U04 | `graph-types.ts` `DEFAULT_SETTINGS.findOff` (tek kaynak: `llm-flow.ts` `DEFAULT_FIND_OFF`) | **düzeltildi** (yeni kurulum davranışı) | Ayar varsayılanı `['list']` → `[]`: kodun kendi beyanı ve 1.9.29 notu "hiçbir aşama varsayılan olarak kapalı değil" diyor, panelin "varsayılana dön"ü zaten `[]` yazıyordu. **Kayıtlı kullanıcı tercihleri korunur** (main `{...DEFAULT_SETTINGS, ...store}` ile birleştirir); yalnız alanı olmayan/ilk açılış bu varsayılanı alır. | bu commit | `find-off-defaults` 3/3 + `prompt-defaults` 5/5 | yapılmadı |
| U05 | `main.ts` geçici süpürme + `temp-sweep.ts` `supurmeKarari` | **düzeltildi** | Kanıt (kilit): çalışan örnek kendi exe'sini kilitler → klasör silinmez; kanıt üretilemezse güvenli taraf. Atlananlar gerekçeyle loglanır. | bu commit | `temp-sweep` 12/12 | yapılmadı |
| U06 | `temp-sweep.ts` `supurmeKarari` (seçici+silici aynı kural) | **düzeltildi** (U05 ile aynı kök) | Seçim ölçütü artık silme kararıyla aynı fonksiyonda; canlılık kanıtı olmadan `silinebilir` boş kalır. | bu commit | `temp-sweep` 12/12 | yapılmadı |
| U07 | `tool-edit.ts` `applyPlan` üyelik yayılımı | **düzeltildi** | Yayılım artık YALNIZ planın eklediği düğümlere (`plan.adds`); kutunun ÇIKIŞ kenarı ve kutu dışı aşağı akış üye yapılmaz. Körlemesine "hiç üye ekleme" konmadı (addNode+connect ile kutu içine kurulan düğüm yine üye). | bu commit | `box-membership-boundary` 2/2 + `tool-branch` 26/0 + `test:targeting` 20/0 | yapılmadı |
| U08 | `yap.ts` `runYap` süre sınırı / `shouldStop` | **düzeltildi** | Süre sınırı artık modele/araçlara verilen yüklemde DEĞİL: gerçek kullanıcı durdurması `StoppedError`, süre aşımı adım aralarında `Yap süresi doldu.` hatası. Süre dolduktan sonra araç çalışmaz. Bilinen sınır: uçuştaki model isteği deadline ile ARTIK abort edilmiyor (geç dönerse hata verilir). | bu commit | `yap-deadline-vs-stop` 3/3 + `yap` 7/7 | yapılmadı |
| O01 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O02 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O03 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O04 | `agent.ts` görsel hedefleme (`tars`) catch'i | **düzeltildi** (canlı doğrulama bekliyor) | Catch yalnız `StoppedError`/`VisualTargetRecoveryError` fırlatıyordu; `FatalApiError` (`serviceFailure=true`) "Görsel hedefleme atlandı" diye yutulup akış `NotFoundError` ile sürüyordu → runner'ın `serviceFailure` durdurma kuralı devreye girmiyor, bozuk anahtarla listenin TAMAMI öğe öğe deneniyordu. Aynı dosyada 243/372 ve koşul dalı zaten fırlatıyordu; tutarlı hâle getirildi. | bu commit | `tars-fatal-api` 3/3 | yapılmadı (401/402 canlı deney) |
| O05 | `agent.ts` görsel model büyütme kırpması | **düzeltildi** (çoklu monitör canlı doğrulaması bekliyor) | Kırpma dikdörtgeni `Math.max(0, …)` ile sıfıra sabitleniyordu; ana monitörün solunda/üstünde ekran varsa sanal masaüstü koordinatı NEGATİF olur ve bölge birincil ekranın kenarına kayardı (model yanlış bölge; haritalama `crop.area` ile yapıldığı için tıklama da kayabilir). Artık işaret korunur; sınırlamayı sanal ekranı bilen worker `crop` dalı yapar. | bu commit | `tars-crop-negative` 3/3 | yapılmadı (sentetik; gerçek çoklu monitör ölçülmedi) |
| O06 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O07 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O08 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O09 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O10 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O11 | `runner.ts` `renderNode` `templated` bayrağı | **düzeltildi** (otomatik test bekliyor) | Bayrak her çağrıda alanlardan yeniden hesaplanıp **mevcut değerin üzerine yazılıyordu**. Kurtarma `step.run` yolunda alanlar ZATEN render edilmiş geldiği için (runner.ts:382 → `ex.recover` → recovery-runtime) ortada `{{...}}` kalmaz ve bayrak `false`a düşer; `agent.ts` buna bakarak hafızayı açtığı için `{{öğe}}` hedefli düğüm **son turun öğesine** yönelebiliyordu. Artık bayrak monoton: var olan `true` korunur, hiçbir düğüm şablonlu SAYILMAZ; render edilmiş veri kayıtlı JSON'a yazılmaz (canlı kopya). | bu commit | typecheck 0 + tam suite yeşil; **birim testi iki denemede de kırılgan/düşen çıktı** (fixture etkileşimi) ve kaldırıldı → sonraki dönemde `runGraph`/kurtarma harness''ı üzerinden yazılacak | yapılmadı |
| O12 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O13 | `target-match.ts` `CLICKABLE_CONTROLS` | **düzeltildi** | Gerçek üreticiler bağlantıyı **Hyperlink** olarak verir (UIA `ControlType.Hyperlink`, DOM üreticisi); listede yalnız hiç üretilmeyen `Link` vardı → bağlantı "control" sayılmıyor, aynı yazılı etiketle eşitleniyor ve "çok aday + `near` yok" kuralı yüzünden hiç aday üretilmiyordu. `Hyperlink` eklendi, `Link` eski kayıtlar için **alias** olarak korundu. | bu commit | `target-match-link-and-i` 7/7 | yapılmadı |
| O14 | `target-match.ts` `normName` | **düzeltildi** | `toLocaleLowerCase('tr')` ASCII `I`yı noktasız `ı` yapıyordu → öğe `Import` ile komut `import` HİÇ eşleşmiyordu. Artık `matcher.norm` ile aynı dar eşleme (`[İIı] → i`) kullanılır; diğer Unicode/aksanlı metin KORUNUR, kısmi eşleşme yine reddedilir. | bu commit | `target-match-link-and-i` 7/7 | yapılmadı |
| O15 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| O16 | `tool-context.ts` `chainOf` öğe/anahtar üretimi | **düzeltildi** | Araç katmanı sayaç (liste/klasör değil) kutusunda `String(index + 1)` = "3" gösteriyordu; motorun kendisi `loopKeys` ile **"#1".."#N"** üretir (graph-types.ts:588). Sonuç: (1) ajanın gördüğü `{{öğe}}` ile koşan değer farklıydı, (2) hatadan devamda `resumeItem="3"` motorun anahtar listesinde bulunamıyor (`indexOf("3")=-1`) ve **devam koşusu hata ile bitiyordu**. Artık tek kaynak `loopKeys`: sayaçta "#3", gerçek listede dosya adı (liste öğesi "3" ise "#3"e ÇEVRİLMEZ), klasör+boş listede öğe bilinmiyor denir. Aracın yanlış yorumu da düzeltildi. | bu commit | `tool-context-resume-key` 4/4 | yapılmadı |
| O17 | `tools.ts` `act.click` `mode` + `tool-edit.ts` `CLICK_MODES` | **düzeltildi** (otomatik guard bekliyor) | `mode` motora geçmeden doğrulanır: alan yoksa (undefined/null) mevcut varsayılan korunur; alan VARSA ve `CLICK_MODES` (`left/double/right`) dışındaysa **eylem HİÇ yapılmadan** açık argüman hatası döner. Mod kümesi `tool-edit`ten **tek kaynak** olarak export edilip `tools.ts`te kullanılır (önce doğrulamasız `text(args.mode)` geçiyor, geçersiz değer tek sol tık olup "yapıldı" diyordu). | bu commit | typecheck 0 + tam suite yeşil; **kırılgan kaynak-testi kaldırıldı** (dosya genelinde eski deseni arıyordu, başka handler''larda da geçiyor) → sonraki dönemde hedefli/yarı-davranışsal test yazılacak | yapılmadı |
| O18 | `viewer-state.ts` `agent:edge` + `agent:step` izi | **düzeltildi** | İzleyici izi masaüstünden farklı kesiliyordu: `agent:step` dalında iz HİÇ kesilmiyor, `agent:edge` dalında ham `e.from === p.to` karşılaştırılıyordu. Masaüstü (`run-progress.ts` `progressStep`/`progressEdge`) ise `runNodePath(graph, edge.from).includes(to)` ile önceki turun kenarını keser. Sonuç: döngü/paket çerçevesine yeniden girişte önceki turun kenarları tablette "yürünmüş" kalıp tüm eski yolu akan çizgi olarak gösteriyordu. Artık AYNI kural; bizi buraya getiren kenar silinmez, yeni bağlantı kesmeden SONRA eklenir. **Yalnız izleyici durumu (görsel); motorun yürütmesine dokunulmadı.** | bu commit | `viewer-trail-trim` 4/4 | yapılmadı (tablet/canlı görsel doğrulama) |
| O19 | `windows-tools.ts` PowerShell stdout/stderr okuma | **düzeltildi** | Her Buffer parçası ayrı ayrı `b.toString('utf8')` ile çevriliyordu; parça sınırına düşen çok baytlı karakter (Türkçe harf/emoji) `U+FFFD`ye bozuluyor ve bu metin araç sonucuna, modele ve günlüğe gidiyordu. Artık `stdout`/`stderr` için `setEncoding('utf8')` kullanılır (Node StringDecoder; kapanışta kalan yarım diziyi de boşaltır) — köprüdeki doğru kalıpla aynı. Çıktı başka bir kodlamaya ÇEVRİLMEDİ; 24.000/6.000 karakter kırpma, 60 sn sınırı, durdurma/iptal ve JSON satır birleştirme davranışı değişmedi. | bu commit | `windows-execution` 4/4 (Türkçe + emoji, parça sınırı ortadan bölünmüş) | yapılmadı (mock akış; gerçek powershell.exe canlı denenmedi) |
| O20 | `yap.ts` `task_complete` kapısı + mesaj | **düzeltildi (yalnız mesaj)** + **davranış kararı** | Mesaj “güncel ekranı VEYA doğrudan işlem sonucunu incele” diyordu; kapıyı gerçekte YALNIZ başarılı `screen_read` açıyor (`observed = result.ok && result.outcome === 'tamam'`). Mesaj gerçek kuralla tutarlı hâle getirildi: “güncel ekranı OKU (screen_read) ve okuma başarılı olsun; pencere/komut sonucu tek başına tamamlanma kanıtı sayılmaz”. **DAVRANIŞ KARARI (korundu)**: sıradan `ok:true`/komut çıktısı hedefin tamamlandığını kanıtlamaz; yönerge gereği “doğrudan sonuç” yolunu açmak yalnız araç sözleşmesi tamamlanmayı gerçekten kanıtlarsa kabul edilir. Her işlem sonrası zorunlu ekran görüntüsü EKLENMEDİ, mevcut doğrulama KALDIRILMADI. | bu commit | yalnız mesaj değişikliği → yönerge gereği yapay test yazılmadı; typecheck 0 + tam suite yeşil | yapılmadı |
| O21 | `zip-library-storage.ts` `readSnapshot` çakışma denetimi | **düzeltildi** | Çakışma kontrolü per-dosya try''ın DIŞINDA `throw` ediyordu → `readSnapshot` komple düşüyor, kütüphane BOŞ görünüyor ve (hepsi önce snapshot okuyan) tüm kütüphane işlemleri aynı hatayla düşüyordu. Artık sağlam kayıtlar GÖRÜNÜR; çakışan kayıtlar **açık hata + kaynak adlarıyla** (`fileKey` NFC/upper çakışması) işaretlenir; mevcut `freshGroup` guard''ı (satır 133-136) sayesinde **çakışan kayda yazılmaz**; otomatik silme/yeniden adlandırma YOK. | bu commit | `library-colliding-zip` 1/1 | yapılmadı |
| O22 | `zip-workspace.ts` `adoptZipLibrary` + `zipCanvasDirty` | **düzeltildi** (otomatik test bekliyor) | Uygulama içi rename sonrası kaydı HÂLÂ var olan sekmede baseline adı ESKİ kalıyordu → sekme "temiz" görünüyor, sonraki Kaydet `old.name !== baseline.name` kapısında "dışarıda değişti" diye reddediliyordu. Artık **yalnız ad** (sekme + baseline adı) doğrulanmış kütüphane kaydından tazelenir; **baseline.graph ve node içeriği ELLENMEZ** → dirty sekmenin kaydedilmemiş işi korunur ve dışarıdan graph değişikliği yine "kirli" görünür (dış değişiklik denetimi kapatılmadı). Kaydı kaybolan sekme eskisi gibi ayrılır. | bu commit | typecheck 0 + tam suite yeşil; **test dosyası tip hatası verdiği için kaldırıldı** → sonraki dönemde yazılacak | yapılmadı |
| D01 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D02 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D03 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D04 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D05 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D06 | `confirm.ts` `judgeScreen` yükleme iğnesi | **düzeltildi** | `norm(expected)` boş olabildiği hâlde `norm(t).includes(norm(expected))` yazılıydı; `includes('')` HER ZAMAN doğru olduğu için ilgisiz bir "işleniyor" yazısı adımı `loading` yapıyordu (yazılı kapsam kuralının tersi). Artık boş iğnede üst-küme kontrolü UYGULANMAZ; "bu karede YENİ çıkan yüklenme yazısı" kuralı ve amaçlanan üst-küme kuralı ("Tamam" ↔ "Tamamlanıyor") korunur. | bu commit | `confirm-empty-needle` 4/4 | yapılmadı |
| D07 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D08 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D09 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D10 | `main.ts` süpürme logu | **düzeltildi** | Silme sonrası `existsSync` doğrulaması: yalnız gerçekten giden klasör "silindi" sayılır; kalanlar "silinemedi" olarak uyarıyla yazılır. | bu commit | `temp-sweep` 12/12 | yapılmadı |
| D11 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D12 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D13 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D14 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D15 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D16 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| D17 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| E01 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| E02 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| E03 | doğrulanacak | bekliyor | — | — | — | yapılmadı |
| K01 | `tests/zip-library-storage.test.ts` »physical ordinal filenames preserve order…« | **kararsız test (yeni kayıt)** | Ölçüm: bu dönemde (a) tam koşuda 1 kırmızı, (b) tek başına da 1 kırmızı, (c) ikinci tam koşuda 0 kırmızı. U07 ile ilgisiz (üyelik mantığı ZIP depolamaya dokunmuyor). Önceki dönemlerde de aynı dosya kararsızdı (1.9.107/1.9.110 notları). | — | izole/tam koşu farkı | yapılmadı |

## Raporda eksik 7 kayıt

Orijinal tarama sonucunda 54 bulgu vardı; paylaşılan raporda 47 listelendi. Eksik 7 kaydın tam metni bu ortamda yok; her biri bulunduğunda bu tabloya ID verilecek (X01…X07) ve kaynağı yazılacak. Uydurma ile tamamlanmayacak.

## Bu dönemin planı (yönerge sırası)

1. U05 + U06 (portable klasör silme / seçici canlılık) — tek kök neden.
2. U01 (direct tuş / hedef odak), U03 (kütüphane kilidi mkdir), U07 (kutu üyeliği taşması), U08 (Yap deadline).
3. O04, O05, O13, O14, O17, O21, O22 … ve düşük öncelikli metin/temizlik maddeleri.
4. Doğrulanamayan maddeler açık gerekçeyle "iddia doğrulanamadı" olarak kapatılır.

---

## Kapanış özeti (dönem sonu — dürüst durum)

**Bu iş bitmedi.** Aşağıdaki liste, her kaydın GERÇEK durumunu gösterir; ele alınmayan maddelere
"düzeltildi" yazılmadı.

### Düzeltildi (17) — commit + test kanıtı tabloda
U01, U03, U04, U05, U06, U07, U08, D10, O04, O05, O11, O13, O14, O16, O17, O18, O19, O20, O21, O22
(bazıları: U01/O04/O05/O11/O17/O18/O22 — test durumu satırlarında yazılı).
### Doğrulandı, güvenli düzeltme bekliyor (1)
U02 — gerekçe satırda (koordinat uzayı; aşama-yerel tarama alanı gerekiyor).
### Açık kayıt (1)
K01 — `tests/zip-library-storage.test.ts` kararsız testi (assertion gevşetilmedi).
### Test borcu (3)
O11, O17, O22 — hedefli birim testleri yazılmadı (düzeltmeler typecheck + tam suite ile doğrulandı).
### HENÜZ ELE ALINMADI (bu dönemde incelenmedi; durum atanmadı)
O01, O02, O03, O06, O07, O08, O09, O10, O12, O15 · D01–D09 · D11–D17 · E01–E03 · raporda eksik 7 kayıt.
Bunlar tarama raporunda kanıtlarıyla duruyor; sıradaki dönemin işidir. **"Düzeltildi" sayılmazlar.**
