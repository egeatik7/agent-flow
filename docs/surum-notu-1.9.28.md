# Sürüm notu — 1.9.28

`feat/spatial-targets` dalının main'e alınmış hâli: hedef bulmada **mekânsal bağlam**.
Kullanıcı tarafından verilen `Nubbo_Spatial_Targets.patch` uygulandı (`git apply --check` temiz,
taban `ab497fc` = 1.9.27).

## Değişen
- Her özgün adayın piksel konumuna ek olarak **ekran alanına göre yüzde konumu** ve en yakın
  **3 komşu kutu** ipucu modele verilir. Aday kimlikleri değişmez; **yakınlık kanıt sayılmaz**,
  yalnız ipucudur.
- **Görev çubuğu bölgeleri Windows UIA'dan ölçülür** (`Shell_TrayWnd` / `Shell_SecondaryTrayWnd`).
  Sabit alt şerit **varsayılmaz**; bölge bulunamazsa "unknown" denir.
- Metinde **masaüstü simgesi/kısayolu** açıkça istenmişse görev çubuğu adayları elenir ve son hedef
  noktası ölçülen görev çubuğu bölgesine düşüyorsa **tıklama gönderilmez** (açık hata verilir).
- Mekânsal açıklama **kullanıcı mesajına** eklenir; **özel kayıtlı sistem promptları değiştirilmez**.
- Bu koşullar sağlanmadığında davranış **aynen eskisi gibi** kalır.

## Doğrulanan
- `typecheck` ✓ · **237 Vitest testi** ✓ (yeni `tests/spatial-context.test.ts`, 5 test) ·
  `test:targeting` 15 test ✓ · `test:keys/input/recovery/stability` ✓ · `pack:win` ✓.

## Doğrulanmayan (dürüst not)
- **Canlı Windows hedef testi yapılmadı**: masaüstü Chrome kısayolu + görev çubuğu düğmesi birlikte
  açıkken doğru hedefin seçilmesi, görev çubuğu bölgesinin canlı ölçümü ve **yan/ikincil monitör**
  görev çubuğu denenmedi. `a11y/screen.ps1`'in yeni UIA fonksiyonu canlı çalıştırılmadı.
- Bu yüzden bu sürüm "mekânsal hedefleme canlı doğrulandı" diye okunmamalıdır.