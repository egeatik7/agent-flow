# 1.9.120 — Görsel hedefte önce fareyi taşı, sonra doğrula ve tıkla

GLM gibi görsel modellerin verdiği ilk nokta artık Tıkla node'unda doğrudan tıklanmıyor. Fare yalnız taşınıyor; yeni, imleç işaretli karede model mevcut konumu onaylıyor veya bir düzeltme noktası veriyor. Onaydan sonra seçili tek/çift/sağ tık modu gerçek imleç konumunda bir kez gönderiliyor. En fazla iki konum düzeltmesi var; belirsizlikte veya görüntü/imleç kanıtı kaybolduğunda tıklama gönderilmiyor.

- Yalnız görsel hedefleme ile çözülen Tıkla hedeflerinde çalışır. UIA/OCR kelime seçimi, Koşul ve Fareyi Oynat node modu bu yeni model çağrısına girmez.
- Mevcut görsel hedefleme yolu tek bir alakasız popup kapatmaya izin veriyorsa o ara tıklama da aynı hizalama/onay yolunu kullanır; popup sayısı artırılmaz, yeni kapatma yetkisi eklenmez.
- Onay modeli tıklama türünü seçemez veya onayla birlikte yeni koordinat gönderemez. Yeni koordinat yalnız taşıma düzeltmesidir ve başka bir yeni kareyle doğrulanır.
- Capture, model görüntüsünde çizdiği gerçek imleç konumunu döndürür; ham OCR karesi değişmez. Worker tıklama anında imleç ve pencereyi yeniden kontrol eder; mevcut imleçten tıklama yolu eski koordinata geri taşımaz.
- LLM → Tıkla → Görsel hedefleme bölümünde düzenlenebilir “Görsel konum doğrulama — önce fareyi taşı” promptu ve sabit yanıt sözleşmeleri gösterilir.
- `visual-pointer-check` gönderim/yanıt kayıtları mevcut kronometre ve aşama kartı altyapısından geçer. Viewer protokolü ve Android kaynakları değişmez; yeni APK gerekmez.

Doğrulama: typecheck ve renderer/Electron derlemesi başarılı; Vitest 897 geçti, 5 atlandı; Node regresyonlarında 98 geçti, 21 atlandı. Temiz 1.9.119 kaynaklarında üç yeni kabul testi eski doğrudan tıklama davranışını göstererek başarısız oldu; patch sonrası aynı testler geçti. Bunlar sahte ekran/model/OS sınırlarıyla çalışır, gerçek GLM doğruluğunu veya canlı Windows tıklamasını ölçmez.

Windows PowerShell harness'i güncellendi, fakat bu ortamda PowerShell/Windows olmadığı için çalıştırılmadı. Canlı Blender/GLM ve telefondaki kart denemesi yapılmadı. Bu teslim kaynak patch'idir; Windows EXE/APK derlenmiş veya GitHub'a yayınlanmış değildir. Eski tuval JSON'ları değiştirilmez.
