# Sürüm notu — 1.9.29

**Kelime listesi → yazı modeli** aşamasının (OCR listesinin LLM'e gittiği yol) varsayılanı düzeltildi.

## Değişen
- `LIST_PROMPT` **tam metinle** değiştirildi: her adayın fiziksel koordinatı, **ekran alanına göre yüzde
  konumu**, komşu ipuçları ve **ölçülen ekran bölgeleri**; komşuluk **ipucudur, kanıt değildir**; aday
  kimlikleri korunur (**birleşik kimlik uydurulmaz**); istenen **yüzey** (masaüstü kısayolu ↔ görev
  çubuğu düğmesi ↔ uygulama içi öğe) ayrıdır, yalnız yanlış yüzeydeki adaylar varsa `id: null`;
  **ölçülen görev çubuğu sınırları** kullanılır, görev çubuğu **her kenarda** olabilir, alçak konum tek
  başına görev çubuğu sayılmaz, bölge bilgisi yoksa **uydurulmaz**; Türkçe ekler/OCR hataları hoş görülür
  ama **olmayan kontrol uydurulmaz**.
- Bu aşama artık **varsayılan olarak AÇIK** (`DEFAULT_FIND_OFF = []`); önceden `['list']` ile kapalıydı,
  yani bu prompt normalde hiç kullanılmıyordu. Varsayılan **tek kaynaktan** okunur (`main.ts`).
- **Kayıtlı özel prompt korunur** (varsa o kullanılır).
- **"Kayıtlı konum" (offset) aşaması değişmedi**; bu prompt artık ona bağlı değil.

## Düzeltilen bağlantı kopukluğu
- `chooseScreenTarget` eylem cümlesini **eski metne** göre değiştiriyordu; yeni metinde o cümle
  olmadığı için yazma node'larında değişim **tutmuyordu**. Eylem cümlesi artık saf `listPromptFor`
  içinde, yeni metne göre ve test edilerek yapılıyor.

## Doğrulanan
- `typecheck` ✓ · **242 Vitest testi** ✓ (yeni `tests/prompt-defaults.test.ts`, 7 test) · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- Prompt değişikliğinin **gerçek hedef isabetine** etkisi canlı ölçülmedi (masaüstü/görev çubuğu
  senaryosu ve yan/ikincil monitör denenmedi).