# Sürüm notu — 1.9.103 (Koşul modeli · yerel sohbet kutusu · kaynak netliği + VRAM)

**Kaynak**: kullanıcının isteği (patch paketi değil). Üç iş:

## 1) Koşul node'u için kendi model seçimi

- `AppSettings`'e **`conditionModel`** + **`conditionBackups`** eklendi; Ayarlar → Genel'de, diğer model
  alanlarıyla (Metin Modeli / Görsel LLM / Yap modeli) **aynı desende** yeni bir **"Koşul modeli"** bölümü var:
  model adı + yedek zinciri (↑↓ sıralama) + **Kaydet**.
- Koşul node'u model çağrılarında **bu zinciri** kullanır; alan **boş bırakılırsa** bugünkü davranış korunur ve
  **Metin Modeli** zincirine düşer. Yedek modeller aynı sırayla denenir.
- Yöntemler → Koşul sekmesindeki model notu artık **Koşul modeli**ni gösterir (boşsa "(boş → Metin Modeli)").

## 2) Yerel model için sohbet kutusu (Yerel Model sekmesi)

- Yeni **chatbox**: çok satırlı giriş + **Gönder** (Ctrl+Enter), mesaj geçmişi ve kompakt "son turlar" listesi.
- Üstte hedef seçimi: **Yerel model** / **OpenRouter (API)** — varsayılan yerel; böylece aynı promptu iki tarafa
  gönderip karşılaştırabilirsin.
- Her cevabın yanında **kaynak etiketi**: `Yerel · <model> · 1.2 sn` ya da `API · <model> · 0.8 sn`, VRAM bilgisi
  varsa `· VRAM 5.1/12.0 GB`.
- Yeni IPC `local:chat` tek mesajlık doğrudan sohbet yapar (yerel taban ya da OpenRouter), otomasyon motoruna
  dokunmaz; yerel uç nokta kurulu değilse **açık Türkçe hata** döner (sessiz kalmaz).

## 3) "Yerel mi API mi cevap veriyor?" — artık net

- Her sohbet turu **Ajan Günlüğü'ne** kaynak etiketiyle yazılır: `[yerel] … → istek gönderildi` ve
  `[yerel] ← 1.24 sn · 812 karakter · VRAM 5.1/12.0 GB` (ya da `[API] …`).
- **Otomasyon koşularındaki** model çağrıları da günlükte `[yerel]` / `[API]` etiketiyle ve model adıyla
  görünür — tek bakışta hangi tarafın yanıtladığı anlaşılır.
- **VRAM raporu** en iyi çaba: önce `nvidia-smi` (`memory.used/memory.total`), yoksa Ollama'nın `/api/ps`
  yanıtındaki `size_vram`; hiçbiri okunamazsa satır **boş kalır** (uydurma değer yazılmaz).

## Doğrulama

- `typecheck` ✓ (üç proje, exit 0) · **Vitest 118 dosya / 941 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.102 tabanı 116/917 → **+2 dosya / +24 test**).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- Yeni testler: `tests/fix-tur6-condition-model.test.ts` (**6/6**) — koşul zinciri metin zincirine düşmez,
  alan boşken Metin Modeli kullanılır, yedek sırası korunur, iki okuyucu da koşul zincirini sorar, yalnız
  birincil boşsa yedek çalışır, varsayılanlar boş. Sıra testi **503 (geçici kesinti)** ile kuruldu; çünkü
  `ModelRejected extends ModelFailed` olduğu için **400'de `chatOnce` aynı modeli JSON'suz bir kez daha
  deniyor** ve zincir ilerlemiyor (ölçüldü).
- `tests/fix-tur6-local-chat.test.ts` (**18/18**) — `directChat` yerel/API yönlendirmesi ve açık hatalar,
  `formatVram`/`parseNvidiaSmi`/`parseOllamaPs` (uydurma yok: okunamayan girdi → boş; geçerli `0/12288`
  okuması "0.0/12.0 GB"), sohbet kutusunun kaynak/süre/VRAM satırı, hedef seçimi, hata bandı.
- Ajanların eşzamanlı düzenlemesi sırasında bir kez yanlış kırmızı görüldü (test dosyası koşu sırasında
  güncellendi); **ağaç sabitlendikten sonra geçidin tamamı yeniden koşuldu ve 0 kırmızı** ✓.
- Son iki küçük düzeltme (ölçüm sonrası, aynı turda yeniden ölçüldü): yerel hedefte `local:` öneki olmayan
  bir ad **yerele kaçmaz** (ayarlardaki ilk yerel satıra düşer) ve günlük satırında modelin **görünen adı**
  yazılır (`[yerel] qwen2.5:7b → istek gönderildi`; önek zaten etikette).

## Sınırlar (dürüst)

- Gerçek yerel sunucu (llama.cpp/Ollama/LM Studio), gerçek GPU ve gerçek OpenRouter anahtarıyla **canlı
  denenmedi**; testler sahte `fetch`/spawn düzeyinde. VRAM metni yalnız `nvidia-smi` ya da Ollama `/api/ps`
  okunabildiğinde dolar.
- Sohbet kutusu otomasyon akışını **etkilemez** (ayrı tek çağrı yolu); koşu sürerken de kullanılabilir ama
  aynı anda tek masaüstü işlemi kuralı çalışma (run) tarafında geçerlidir.
- 1.9.98–1.9.102 notlarındaki diğer açık kalemler değişmedi.
