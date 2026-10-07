# Sürüm notu — 1.9.30

**Gerçek OCR kelimeleri ve tek kelimenin içine tıklama** + kalıcı OCR kelime promptu.

Kaynak: kullanıcının verdiği `Nubbo_OCR_Words` paketi. `FULL.patch` **uygulanmadı** (tabanı 1.9.27;
1.9.29'da mekânsal düzeltme ve prompt değişikliği zaten var → temiz uygulanmıyordu, zorlanmadı).
`INCREMENTAL.patch` 8 dosyanın **6'sında temiz** uygulandı; çakışan iki dosya şöyle aktarıldı:
`llm-flow.ts` → yalnız prompt metni (`OCR_Kelime_Promptu.txt` birebir), `openrouter.ts` → patch sonrası
referans (`source/`) alınıp 1.9.29'un `listPromptFor` düzeltmesi üstüne yeniden bağlandı.

## Değişen
- **Kelime düzeyinde hedefleme**: Windows OCR'ın `line.Words` → `BoundingRect` değerleri artık
  `ScreenItem.words` olarak taşınıyor; metni boşluklardan bölüp **konum tahmin edilmiyor**.
- Modele **tüm gözlenen kelimeler** x/y/w/h + **yüzde konum** ile verilir; eski 400 satır kesmesi bu
  listeye uygulanmaz. `wordCandidates` yalnız model çağrısı için **geçici, çakışmayan** kimlik üretir;
  UIA/DOM kimlikleri ve gerçek tarama kimlikleri **değişmez**.
- Model **tek** aday döndürür: `{"id": <tek aday>, "text": …, "reason": …}`. Geçici kelime kimliği
  **aynı çağrıda** gerçek parent ID + `wordIndex`'e çözülür; modelin `text`/`x`/`y` alanları kutuyu
  **değiştiremez**. Birden fazla ID, olmayan ID veya listede gösterilmeyen OCR parent ID'si **kabul edilmez**.
- Motor `refineWordTarget` ile **seçilen kelimenin kutusu içinde** tıklama noktası hesaplar; **satırın/grup
  ortalamasına tıklanmaz**, `wordIndex` geçersizse satır ortasına **geri dönülmez**. İkinci bakış aynı
  parent içinde başka bir kelime seçerse o kelime uygulanır.
- **Kalıcı prompt** (`LIST_PROMPT`) `OCR_Kelime_Promptu.txt` ile **birebir** değiştirildi: kelime bulutunu
  oku, **tek kelime** seç, grup merkezine değil **kelimenin içine** tıkla, koordinat/çoklu ID döndürme;
  yüzey ayrımı; ölçülen görev çubuğu; kelime geometrisi yoksa dürüstçe işaretlenir ve **çok kelimeli
  yalnız-bağlam kutuları seçilemez**; konum **uydurulmaz**; JSON-only.
- **Kayıtlı özel prompt aynen kullanılır**: kullanıcının metni değiştirilmez, cümle eklenmez.
- "Kelime listesi → yazı modeli" aşaması varsayılan olarak **açık** kalır (1.9.29).

## Doğrulanan
- `typecheck` ✓ · **250 Vitest testi** ✓ (yeni `tests/word-targets.test.ts` 8 test + `prompt-defaults` 7) ·
  `test:targeting` ✓ · `test:keys/input/recovery/stability` ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Canlı Windows hedeflemesi ölçülmedi**: gerçek OCR kelimesine tıklama, görev çubuğu bölgesi, yan/ikincil
  monitör ve "tek kelime" davranışının model üzerindeki etkisi denenmedi.