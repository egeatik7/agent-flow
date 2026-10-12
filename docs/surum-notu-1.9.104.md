# Sürüm notu — 1.9.104 (bilgi kartında canlı zamanlayıcı geri sayımı)

**Kaynak**: kullanıcının isteği (patch paketi değil).

> "zamanlayıcı nodesinin adını aşağıda görelim eyw, ama bilgi kartında bi geri sayım da görebiliriz bence, yap."

## Yapılanlar

**Zamanlayıcı adımı sürerken kartın İÇİNDE canlı geri sayım.**
- `electron/main.ts`: her adım başlangıcında çalışan node çözülür (1.9.100'de eklenen `hudStep`); node türü
  **`wait`** ise kart için bir **geri sayım** başlar. Süre node'un kendi `ms` alanından okunur, satır
  **200 ms**'de bir tazelenir (5 kez/sn: göz için akıcı, IPC için ucuz).
- Satır biçimi: **`Zamanlayıcı · <node adı> · kalan 3,2 / 5,0 sn`** (Türkçe ondalık virgül, `tabular-nums`
  ile rakamlar zıplamaz). Yani hem **ad** hem **geri sayım** aynı satırda; node adı ayrıca alttaki yöntem
  satırında (`Zamanlayıcı · <node adı>`) durmaya devam ediyor.
- **Temizlenme:** adım `done`/`error` olayı geldiğinde, sıradaki adım başladığında ve koşu bittiğinde satır
  boşaltılır. Süre bittiğinde sayaç kendini bırakır ama satır **`kalan 0,0 / …`** olarak kalır — kart,
  adımın gerçekten bittiğini söyleyen olayı beklerken "hâlâ sürüyor" izlenimi vermez.
- Yeni kanal **`hud:countdown`** (main → preload → `Hud.tsx`), `src/styles/xp.css` içinde XP görünümlü
  `.hud-countdown` satırı (noktalı ayraç, kalın, tabular rakamlar). HUD gizlenirken satır da sıfırlanır.
- Süresi **0** olan zamanlayıcıda geri sayım açılmaz; Tıkla/Yazı/Koşul/Yap adımlarında da sayaç kurulmaz
  (varsa önceki temizlenir). Türetilmiş (branch) koşularda ve koşu dışında karta dokunulmaz.

## Doğrulama

- Yeni `tests/fix-tur7-countdown.test.ts` **7/7** ✓ — gerçek `hudStep`/`startHudCountdown`/`stopHudCountdown`/
  `sn` gövdeleri `main.ts`'ten çıkarılıp **sahte zamanlayıcı** ile koşturuluyor: ilk satır `5,0 / 5,0`,
  2 sn sonra `3,0 / 5,0`, adım `done` olunca satır boşalıyor, süre bitince sayaç kendini bırakıyor
  (yeni interval kurulmuyor) ve satır `0,0` olarak kalıyor, `ms=0` olan zamanlayıcıda satır hiç açılmıyor,
  ikinci zamanlayıcı önceki sayacı devralmıyor, koşu dışı/türetilmiş koşuda sayaç kurulmuyor,
  `sn(3200) === '3,2'`.
- `typecheck` ✓ (üç proje) · **Vitest 119 dosya / 948 geçti / 1 atlandı / 0 kırmızı** ✓
  (1.9.103 tabanı 118/941 → **+1 dosya / +7 test**).
- **Beş Node paketi + `test:lock`** ✓ — keys 3, input 7, recovery 27 (+12 atlandı), targeting 20,
  stability 40 (+9 atlandı), lock 1; hepsi 0 kırmızı. **On bir PS 5.1 harness'i** exit 0 ✓.
- Bu değişiklik iki harness'i kırdı ve **ikisi de düzeltildi** (ölçülmüş kanıt): `runFlow`'un koşu sonunda
  geri sayımı bırakması `scripts/test-stability-main.cjs` sanal bağlamında yoktu → `# fail 5`;
  `tests/fix-tur5-hud.test.ts` de yeni geri sayım gövdelerini çıkarmıyordu → `ReferenceError`. İkisi
  güncellendikten sonra stability **40/0**, HUD testleri **13/13**.

## Sınırlar

- Geri sayım **kartta**; canlı masaüstünde gerçek bir koşuyla gözle denenmedi (testler `vm` + sahte
  zamanlayıcı düzeyinde). Süre, node'un yapılandırılmış `ms` değerinden sayılır; adım durdurma/kesinti
  ile erken biterse satır adım olayıyla temizlenir (ölçüldü), aksi bir durumda kalan süre ile gerçek
  bekleme birkaç yüz ms şaşabilir.
- 1.9.98–1.9.103 notlarındaki diğer açık kalemler değişmedi (canlı yerel sunucu/GPU testi, typeText'in
  korumalı dalı, Yap `allowCode` varsayılanı, ONNX hatasının görünmemesi, izin kapsamı, yerel model
  anahtarı, profil klasörü çakışması, exe damgası, tablet testi).
