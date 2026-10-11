# Bug taraması — 1.9.82 (`373983a`)

**Yöntem.** Kod 6 bağımsız alana bölünüp paralel tarandı (motor, hedef+girdi, model katmanı, arayüz, kurtarma+IPC,
Windows köprüsü+betikler). Her alanın **en yüksek iddiaları tek tek satır satır doğrulandı**; işaret edilemeyen iddia
rapora alınmadı. **2 iddia yanlış çıktı ve çürütüldü.** Tarama sırasında **hiçbir kaynak dosya değiştirilmedi**.

Kapsam: 228 dosya / 40.088 satır · taban: commit `373983a`, sürüm 1.9.82, ağaç temiz.

---

## A) Koşuyu saatlerce boşa çevirenler

| Bulgu | Kanıt |
| --- | --- |
| **`runModelChain` kalıcı hatada SONSUZ döner.** `for(;;)` yalnız `ModelRejected` sayar; `ModelFailed` sayacı sıfırlar. Yerel sunucu 500/OOM/413/415 ya da `{"error":…}` gövdesi 4 sn'de bir sonsuza kadar denenir; yalnız **Durdur** çıkar. | `electron/openrouter.ts:286,296,303-308` |
| **`isApiDown` yanlış pozitifi.** Regex'te `quota` / `bakiye` çıplak; hata mesajı kullanıcı metnini taşıdığı için “Bakiye Sorgula” gibi bir düğme adı API kesintisi sanılır → **ilk hatada** döngü durur. | `electron/runner.ts:96`, `:559-561` |
| **“Aynı hata iki kez” koruması etkisiz.** `msg === lastFail` tam metin karşılaştırır; metinde öğe promptu ve ekran örneği vardır → kalıcı arızada **tüm liste** denenir. | `electron/runner.ts:557-559` + `electron/agent.ts:553-559` |
| **Paket çıkışı döngü üyesindeyse** `observeExit` hiç ateşlemez (`!scope` şartı) → motor “kayıtlı çıkışına ulaşmadı” deyip akışı sessizce bitirir, tuval sonraki adımı göstermeye devam eder. | `electron/runner.ts:199-202` + `src/lib/graph-ops.ts:313-316` |
| **Yalnız döngü kutularından oluşan çevrim** adım limitini aşmaz (`maxSteps`/`budget.used++` yalnız `else` dalında); imza koruması `debug` ve başarılı tur şartına bağlı → gerçek ekran eylemleriyle sonsuz döner. | `electron/runner.ts:360-364`, `:578` |

## B) Sessiz yalan / yanlış başarı

| Bulgu | Kanıt |
| --- | --- |
| **Tıklama uyarısı yutuluyor.** Worker “nokta başka pencerede; yine de tıklandı” der, `clickAt` dönüşü `void` olduğu için atılır → günlük yeşil “Tıklandı” yazar. (`moveMouse` uyarıyı loglar.) | `a11y/worker.ps1:1121` + `electron/a11y-bridge.ts:395-398` |
| **`sent:true` yalanı.** Fareyi-Oynat modundaki Tıkla girdi göndermez, ama `sent: node.kind !== 'wait'` true döner; `failedNodeSent` yalnız `outcome`'a bakar → `recovery_retry` reddedilir, akış ilerleyecekken durur. | `electron/recovery-runtime.ts:100` + `electron/recovery.ts:188`, `:164` |
| **Merge sildiği node'ları bildirmiyor.** `tail` budama notlarından önce hesaplanır; `data` `removed` taşımaz. Onu koruduğu sanılan test `toContain('silindi')` ile “Tarif silindi” cümnesine takılır → yeşil test gerçek boşluğu gizler. | `electron/tools.ts:663,704-706,723` + `tests/tool-branch.test.ts:479,761` |
| **Bağlantısız “yok” çıkışı** akışı bitirir ama koşu `ok:true` döner (yalnız bilgi satırı yazar). | `electron/runner.ts:425-431` + `electron/main.ts:737` |
| **Başarısız ekran görüntüsü** sessizce yutulur: `captureFailure(...).catch(() => {})` → kanıt yok, günlük yok. | `electron/runner.ts:556` |

## C) Para, gizlilik, disk

| Bulgu | Kanıt |
| --- | --- |
| **API anahtarı log'a düşebilir.** Kontrollü ölçüm: `Headers.append: "Bearer sk-…⏎sk-…" is an invalid header value.` (Node v22.23.3) — hata mesajı başlığı yankılar; repoda hiçbir CR/LF temizliği yok. | `electron/openrouter.ts:39,126,300` + grep |
| **`nubbo-screen-*.png` sızıntısı.** İki ajan bağımsız buldu; tüm repoda silen yok. Ölçüm: `%TEMP%` içinde ~70 dosya / ~40 MB. Sürücü kurtarma ajanıdır (kurtarma başına ≤60 okuma, koşu başına ≤100 kurtarma). | `electron/tools.ts:1541` + `electron/recovery-runtime.ts:100` çevresi |
| **`x=1` yanlış kenara tıklar.** Prompt “0-1000 … NOT 0-1 fractions” der; kod `x > 1 ? x/1000 : x` → sol kenar hedefi sağ kenara gider. | `electron/openrouter.ts:862` + `electron/llm-flow.ts` prompt |
| **`localVision` beyanı çalışma anında ölü** (tek tanım, çağıran yok) → metin-only yerel model yine ekran görüntüsü alır. | `electron/openrouter.ts:147` + grep |

## D) Arayüz

| Bulgu | Kanıt |
| --- | --- |
| **LLM panelinde kaydedilmemiş prompt düzenlemeleri silinir** (sekme değişimi ya da herhangi bir ayar yazımı yerel state'i yeniden tohumlar). | `src/components/LlmPanel.tsx:28-37` |
| **Döngü satırı menüsü kapanmaz**; koşu başlarsa kapsayan `disabled` fieldset düğmelerini kapatır → kapanamaz hâle gelir. | `src/components/SidePanel.tsx:236-259` + `src/App.tsx:1513` |
| **Tuval menüsü / Shift+A paleti tuval-paket değişiminde yaşar** → yeni tuvalde eski koordinata node ekler ya da bayat id ile hayalet koşu başlatır. | `src/components/NodeCanvas.tsx:156,627-632` |
| **Döngü satırı boşaltılamaz** (`if (e.target.value.trim())` boş geçişi düşürür) → DOM grafikten ayrışır. | `src/components/SidePanel.tsx:216-224` |
| **Zaman aşımı alanları** her render'da kırpılır → “300” yazmak 10→100→900 üretir. | `src/components/RecoverySettingsPanel.tsx:107` · `src/components/LocalModelSettings.tsx:60` |
| **`maxSteps === 500` sessizce 2000'e çevrilir** (bilerek yazılan erken sınır yutulur). | `electron/main.ts:86` |
| **Kurtarma raporu `canvasId`siz** kalır → eksik alan “her tuval için uygun” sayıldığından rapor başka tuvallerde görünür. | `electron/main.ts:685` + `src/lib/recovery-report-view.ts:7` |

## E) Geliştirme betikleri (kanıt üretimini bozar)

| Bulgu | Kanıt |
| --- | --- |
| **Temp süpürücü ölü**: `dev-start-test.cjs` `os`'u require etmez → `ReferenceError` kör `catch` ile yutulur. | `scripts/dev-start-test.cjs:15-18,91` |
| **`dev-status` damga uyarısı sürekli yanar**: `sha-dirty` damgası düz `sha` ile karşılaştırılır. | `scripts/dev-status.cjs:47` |
| **Profil adı 4 uygulamada tutarsız** (`_` bazı yerde korunur, bazı yerde atılır; `test` dışı ad gerçek profile düşer). | `electron/profile.ts:24` · `scripts/nubbo-cli.cjs:134` · `scripts/dev-status.cjs:34` |
| **Senaryo koşucusu kapsam kontrolü olmadan dosya siler** (mutlak gerçek yol verilirse silinir; “olmaması beklenen” dosya kanıtla birlikte silinir). Latent: mevcut 6 senaryoda mutlak yol yok. | `scripts/dev-scenario.cjs:239-240,316` |
| **`dev-idle` ölçemezse “serbest” der** (`idle === -1` → `free:true`, `exit 0`). Çağıranlar bugün yeniden hesaplıyor → latent. | `scripts/dev-idle.cjs:36,51` |

---

## Çürütülen iddialar (rapora alınmadı)

1. **“İnisiyatif ekranda hiç tıklamıyor”** — yanlış. `agent.ts:1454` tıklamayı **yalnız ilk öneride** harekete çevirir;
   `:1489` bayrağı tıklamadan **sonra** yazar ve `move` `true` döner → desen **hareket → tıklama**'dır.
2. **“Her doğrulama taraması hedef pencereyi öne alıp menüleri kaçırıyor”** — yanlış. `snap` `bridge.scan`'i doğrudan
   `fresh:true` ve **`windowTitle`siz** çağırır; `screen.ps1:767` odağı çalan dal **atlanır**.

## Doğrulanmamış kuyruk (iddia olarak duruyor)

`message.content` dizi gelirse · `data.error` string gelirse · UAC/güvenli masaüstü kör noktası · `replayPath`
bayat koordinat · `canvasDirty`/`saveCanvas` temel farkı (legacy çift sekme) · paket içi `debug` taşınmaması ·
`graph:save` normalize etmemesi · `shell.openPath` hatalarının yutulması · `shell:showItem` her yolu açması ·
`runOneAction timeoutMs:0` · rampa önizlemesi bayat · modal açıkken Delete · `typeDirect` hep `false` ·
`Switch-TextCase` tek karakter · `actFields` ölü kod · `replay-target.cjs` taklidinin dar yüzeyi.

## Önerilen düzeltme sırası

1. `runModelChain` sınırsız döngüsü (kalıcı hataları `ModelRejected` say + tur üst sınırı)
2. `nubbo-screen-*` TEMP sızıntısı (süpürme/temizlik)
3. API anahtarının log'a düşmesi (kaydetmeden önce CR/LF temizle + log satırlarında maskele)
4. Menü hataları: dışarı tıklama/Escape ile kapat + `canvasKey` değişince `menu`'yü sıfırla
5. `isApiDown` çıplak `quota/bakiye` + “aynı hata” karşılaştırmasını normalleştir
6. Merge mesajı (`tail` sonra hesaplansın) + testi silinen node'ları arayacak şekilde yaz
7. `sent:true` · `localVision` · `x=1` · `canvasId` · `maxSteps` · LLM paneli kaybı