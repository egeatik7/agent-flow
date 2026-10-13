# UYGULAMA.md — Nubbo bulgu düzeltmeleri (yönerge uygulaması)

## Gerçek taban
- Depo: `egeatik7/agent-flow`
- Taban commit: **1d643b2** (main, sürüm **1.9.120**, dal `feat/hud` sonrası HUD düzeltmesi commit'i)
- Çalışma dalı: `fix/bulgu-taramasi-1.9.120`
- Patch: `nubbo-bulgu-duzeltmeleri.patch` — SHA256 `3E50C1D5A8324C610CEA1235C40FE0A6D8A939D6A0E774E5D64B35AE7BD7120D`
- Patch 30 dosya, +856/−61.

## Uygulama
```powershell
git apply --check nubbo-bulgu-duzeltmeleri.patch   # doğrulama
git apply        nubbo-bulgu-duzeltmeleri.patch   # uygulama (zorlama YOK)
npm ci ; npm run typecheck ; npx vitest run
```
Patch, tabanın **temiz kopyasında** doğrulandı (`git worktree add --detach <tmp> 1d643b2` → `git apply --check` **exit 0**).

## ÖNEMLİ — main ilerledi (elle birleştirme notu)
Bu iş yapılırken `main` **1.9.122**'ye ilerledi (paket: `Nubbo_Gorsel_Fare_Onayi_1.9.120` → görsel fare taşıma/konum onayı, `electron/visual-hover.ts` yeni). O paket şu dosyalara da dokundu:
`a11y/worker.ps1`, `electron/agent.ts`, `electron/llm-flow.ts`, `electron/matcher.ts`, `electron/openrouter.ts`, `electron/a11y-bridge.ts`, `a11y/screen.ps1`, `package.json`.
Bu patch de **`a11y/worker.ps1`** ve **`electron/agent.ts`** dosyalarını değiştiriyor. Bu yüzden:
- Patch **1.9.120 tabanına** temiz uygulanır; **1.9.122 üzerine doğrudan uygulanırsa bu iki dosyada çakışma beklenir** ve elle birleştirme gerekir (aynı dosyada farklı satırlar; mantık çakışması yoktur).
- Çakışma çözümünde **1.9.122'nin getirdiği görsel fare/konum onayı kodu korunmalı**, bu patch'in U01/O04 düzeltmeleri de eklenmelidir.
- Yeni node türü, şema değişikliği veya göç yoktur.

## Kapsam dışı bırakılanlar (yönerge gereği)
- Koşul node'u davranışı, UIA/OCR seçim sırası, kısa ikinci kelime seçimi ve mevcut tuval/kütüphane JSON şemaları **değiştirilmedi**.
- Otomatik merge/push/yayın/EXE dağıtımı bu dalda **yapılmadı**.
- Canlı GLM/Blender/Windows doğrulamaları **yapılmadı** (bkz. DOGRULAMA.md).
