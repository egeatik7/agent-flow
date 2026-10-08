# Sürüm notu — 1.9.47

**İnisiyatif: "belge uygulama değildir" kuralı.** Kaynak: kullanıcının 1.9.46 günlüğü.

## Ölçülen gerçek sorun (koordinat/ölçek DEĞİL)
```
İnisiyatif (bytedance/ui-tars-1.5-7b → …, UI-TARS sırada)      ← birincil model 7B'lik UI-TARS
Thought: "…there isn't a program called Blender 5.2. However, I did see a file named
          'blender2.blend' …"                                  ← .blend DOSYASINI uygulama sandı
→ çift tıkladı → yürütüldü (%51,%21)   ← DOĞRU yere tıklandı ✓
Thought: "…dialog asking me to choose a default application…"   ← Windows "varsayılan uygulama" diyaloğu
```
Koordinat zinciri **doğru** çalışıyor (663/1292 = %51, 543/1292 = %42 — TARS piksel → görüntü oranı ✓).
Hata **modelin hedef seçiminde**: masaüstünde Blender kısayolunu göremedi ve bir **`.blend` dosyasını**
açmayı denedi; bu yalnızca "varsayılan uygulama seç" diyaloğunu açar ve görevi saptırır.

## Değişen
- `INITIATIVE_SCOPE_RULES`'a açık kural eklendi: **belge (.blend/.txt/.png/.jpg/.pdf/.docx …)
  uygulamanın yerine açılmaz**; istenen uygulama/kısayol ekranda yoksa `call_user`/`fail` döner.
  Bu kural **kayıtlı eski özel promptlarda da** geçerlidir (runtime sözleşmesi).

## Doğrulanan
- `typecheck` ✓ · Vitest 44 dosya / 288 test ✓ · beş Node paketi ✓ · `node --test` recovery+agent ✓ ·
  **8 PowerShell harness hepsi PASS** ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst)
- **Gerçek koşuda bu kuralın modeli durdurduğu HENÜZ ÖLÇÜLMEDİ.**
- Asıl kaldıraç **model seçimi**: bu koşuda **birincil model 7B'lik UI-TARS**'tı; güçlü bir görsel
  model (Luna/Gemini sınıfı) bu masaüstünde kısayolu bulmakta belirgin biçimde daha iyidir.
  Bu bir **kod** sorunu değil, ayar tercihidir.
- **PowerShell 7 kurulu değil → atlandı.**