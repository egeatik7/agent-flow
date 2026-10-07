# Sürüm notu — 1.9.46

**"Yazı alanı değil" reddi kaldırıldı — tıklanan alana artık YAZILIR.** Kullanıcının isteği:
*"odak yazı alanı ama yazı alanı değil diyo … denese aslında yazıverecek oraya."*

## Kanıt (1.9.45 gerçek koşu günlüğü)
```
[13] Yaz: "Custom GLB"
WARN   Yazı gönderilmedi: INPUT_FOCUS_UNRESOLVED; UIA=Window, native=GHOST_WindowClass,
       pencere=* (Unsaved) - Blender 5.2.0 LTS, HWND=4263602, caret=null
ERROR  Odak bir yazı alanı değil (Window) — * (Unsaved) - Blender 5.2.0 LTS.
```
**Blender'ın yazı alanı** UIA'da `Window`, native'de `GHOST_WindowClass` ve **caret null** geliyor →
sınıflandırma orada **asla** başaramaz, ama alan gerçekten yazı kabul eder.

## Değişen (iki katman)
1. **Worker** (`typeText`): sınıflandırma kapısı artık **tıklanmış nokta varsa** (`$P.at`) kapanmıyor →
   odak "yazı gibi" görünmese ve görsel kanıt olmasa bile **yazı gönderilir**. Diğer durumlarda
   (tıklama kanıtı yok) eski davranış **aynen** durur.
2. **Agent** (`write`): worker yine de reddederse ve elimizde **bağlı bir tıklama noktası** varsa
   **düz yazma** denenir (guard'sız, sınıflandırmasız) ve sonuç açıkça loglanır:
   *"Alan sınıflandırılamadı (…); tıklanan alana yine de yazıldı. Değer okunamadıysa doğrulanmamış
   sayılır."* — yani **belirsiz sonuç başarı gibi raporlanmaz**.

## Korunanlar
Salt-okunur/düğme reddi **tıklama kanıtı olmayan** yollarda aynen duruyor; durdurma, odak/pencere
kimliği ve tek-Enter kuralları değişmedi.

## Doğrulanan (hepsi YEŞİL)
- `typecheck` ✓ · **Vitest 44 dosya / 288 test** ✓ · `test:keys/input/recovery/stability/targeting` ✓
  (`recovery`: **38 pass / 0 fail**) · `build:electron` ✓ · **9/9 PowerShell harness** ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst)
- **Gerçek koşuda Blender alanına yazıldığı HENÜZ ÖLÇÜLMEDİ**; doğrulama yeni bir koşuyla yapılacak.
- **PowerShell 7 kurulu değil → atlandı.**