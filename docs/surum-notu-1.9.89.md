
## ⚠️ Geçit bir kez kırmızı çıktı → **yayın durduruldu**, sonra düzeltildi ✗
`npm run test:stability` **45–48** ✗: **`ReferenceError: viewerState is not defined`** ✗. **Kök neden** ✓: harness
`scripts/test-stability-main.cjs`, **`runFlow`'u `main.ts` kaynağından çıkarıp** bir **vm kum havuzunda** koşuyor ✓ ve
yeniden kurduğum `main.ts`'te `runFlow` artık **`viewerState.begin(runId, …)`** ✓ (satır 662 ✓) ve
**`viewerState.finish(outcome)`** ✓ (816 ✓) çağırıyor ✓ — kum havuzunda bu global **tanımlı değildi** ✗. Harness'in
**kendi kuralı** da bunu yazıyor ✓: *“the harness needs the same surface `runFlow` uses”* ✓ → eksik yüzey **tamamlandı** ✓
(`viewerState: { begin, finish, event, setBook, setReports }` ✓). **Davranış regresyonu yok** ✗ — yalnız **taklit yüzey
eksikti** ✓; testler **zayıflatılmadı** ✗.