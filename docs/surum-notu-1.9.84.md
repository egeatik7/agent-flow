# Sürüm notu — 1.9.84 (Yerel modelde düşünme modu)

## Ne geldi
- **Yerel Model sekmesine “Düşünme modu” seçicisi** ✓: **Otomatik (Ollama’da kapalı)** ✓ ·
  **Kapalı — en hızlı** ✓ · **Açık — düşük/orta/yüksek** ✓. Aynı ekranda ölçüm de yazılı ✓
  (kapalı **0,1 sn** ✓, açık **1,4 sn** ✓ ve kısa yanıt bütçesi düşünmeye gidip **cevap boş kalabiliyor** ✓).
- **Yeni ayar `localThink`** ✓ (`electron/graph-types.ts` + `DEFAULT_SETTINGS = ''` ✓). Boş dize **otomatik** demektir;
  eski kayıtlar bu değerle **eskisi gibi** davranır ✓ — göç gerekmez ✓.
- **İstek gövdesine `reasoning_effort`** ✓ (`electron/openrouter.ts`): kullanıcı bir seviye seçtiyse **o değer** ✓;
  seçim yoksa **yalnız Ollama adreslerinde `none`** ✓. Ollama olmayan yerel sunucularda (llama.cpp / LM Studio)
  gövde **birebir eskisi gibi** kalır ✓ — bilinmeyen alanı reddedebilirler ✓.
- “Yerel ayarları kaydet” düğmesi `localThink` alanını da yazar ✓.

## Neden `reasoning_effort`, neden `think` değil
Ölçüm (11 Ekim 2026, RTX 3060 12 GB, qwen3.5:9b Q4_K_M, `/v1/chat/completions`, 3 tekrar):

| İstek | Süre | Düşünme | Cevap |
| --- | --- | --- | --- |
| parametresiz | 1372 / 1333 / 1358 ms | var (289 krkt) | **boş** |
| `reasoning_effort:"none"` | **114 / 97 / 92 ms** | 0 | `4` |
| `reasoning_effort:"low"` | 1934 ms | var (285 krkt) | boş |
| `think:false` | 2037 ms | var (267 krkt) | boş — **yok sayıldı** ✗ |

Dördü de **denendi ve kanıtlandı**: Modelfile’da `PARAMETER think` ve `PARAMETER thinking` →
`Error: unknown parameter` ✗; `OLLAMA_*THINK*` diye ortam değişkeni **yok** ✗; `/no_think` ve `/nothink`
(sistem isteminde de, kullanıcı mesajında da) **işe yaramıyor** ✗ (278–473 krkt düşünme üretti ✓).
Bu yüzden alan istemci tarafında ekleniyor ✓. **Tekrar denenmesin.**

## Ollama tarafı (bu makinede yapılandırıldı)
- **`qwen3.5-8k`** ✓ = `FROM qwen3.5:9b` + `PARAMETER num_ctx 8192` → çalışan yürütücüde
  `ollama ps` **CONTEXT 8192** ✓, runner komutu **`-c 8192`** ✓.
  (Dürüst ayrım ✗: `ollama show` çıktısındaki **“context length 262144”** mimari üst sınırdır ✓;
  etkin varsayılan **Parameters** altındaki **num_ctx 8192**’dir ✓.)
- `qwen3.5:9b` etiketine de aynı ayar gömüldü ✓; **`qwen3.5:9b-orjinal`** yedek olarak duruyor ✓.
- Ayarlar veritabanında (`%LOCALAPPDATA%\Ollama\db.sqlite`) **`think_enabled=0`** ✓.
  **Ölçülen sınır** ✗: `context_length`’ı 8192 yazdım, uygulama açılışta **geri 0’a çekti** ✓
  (0 = VRAM’e göre otomatik) → bağlamın kalıcı yolu **model katmanı**dır ✓, ayar dosyası değil ✗.
- VRAM: **7731 MiB kullanılan / 4385 MiB boş** ✓ (istenen: 8 GB altı kullanım ✓, 4 GB üstü boşluk ✓).

## Doğrulama (bu makinede, Windows ✓)
`typecheck` ✓ · **Vitest 88 dosya / 636 test** ✓ (bu sürümde **+2 test** ✓) · **sekiz Node regresyon 118/118** ✓ ·
**beş npm paketi** ✓ (`input` 7/7 ✓ · `recovery` 39/39 ✓ · `targeting` 20/20 ✓ · `keys` 3/3 ✓ · `stability` 49/49 ✓) ·
**PS 5.1 harness’leri** ✓ · **uçtan uca** ✓: agent-flow’un **derlenmiş** modülü → gerçek Ollama,
görsel istek **756 ms** ve doğru tanım ✓ (“Kırmızı renkli, düşük poligonlu stilde bir araç modeli” ✓).

## Doğrulanmayan (dürüst ✗)
- **Canlı arayüz tıklaması yapılmadı** ✗: seçici React testinde sınanıyor ✓, gerçek pencerede elle denenmedi ✗.
- **agent-flow içinde gerçek bir otomasyon koşusu yapılmadı** ✗; yalnız modül yolu doğrudan çağrıldı ✓.
- **`npm run test:desktop` bu makinede düşüyor** ✗ (`-2147483645`) — **temiz ağaçta da aynı** ✓,
  yani bu değişiklikten değil ✓; beş `test:*` paketinin dışında kalır ✓.
- **Bayraksız düz `ollama run`** hâlâ düşünüyor ✗ (`--think=false` gerekiyor ✓): Ollama’da model düzeyinde
  düşünme varsayılanı değiştirilemiyor ✗ — yalnız istek bazında kapatılabiliyor ✓.
