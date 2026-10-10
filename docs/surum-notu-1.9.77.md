# Sürüm notu — 1.9.77 (döngü öğelerine sağ tık: **Yolu aç** · çift tık: **öğeyi aç**)

Kullanıcının **kendi cümlesiyle** verdiği istek ✓: *"sağ tarafta döngülerin içine klasörler ya da glb ler falan geliyo ya, onlara sağ tıklayınca yolu aç çıksın; ona basarsam bulunduğu klasörü açsın o öğenin, çift tıklarsam direk açılsın o şey her neyse."*

## Gelen
- **Sağ panelde döngü listesinin her satırına sağ tık** ✓ (`src/components/SidePanel.tsx` · `LoopEditor` ✓): küçük bir menü açılır ✓ —
  **“Yolu aç”** ✓ (`shell.showItemInFolder` ✓ = öğenin **bulunduğu klasörü** açar ve **öğeyi seçer** ✓),
  **“Öğeyi aç”** ✗ (aynı işi menüden de yapabilmek için ✓), **“Kapat”** ✓; menü başlığında **öğe adı** görünür ✓.
- **Çift tık → öğeyi doğrudan açar** ✓ (`shell.openPath` ✓): **klasörse Gezgin** ✓, **dosyaysa kendi uygulaması** ✓
  (GLB için varsayılan uygulama neyse o ✓ — "her neyse" ✓).
- **Yol çözümü** ✓: öğe **mutlak** yolsa (`C:\…` / `\\…` ✓) aynen kullanılır ✓; **göreliyse** döngünün
  **Klasör** alanıyla birleştirilir ✓; klasör alanı **boş** ya da **şablon** (`{{öğe}}` ✓) içeriyorsa yol
  **çözülemez** ✗ → menü düğmeleri **devre dışı** kalır ✓ ve nedeni `title`da yazar ✓ (**yanlış yere açmaktansa
  açmamak** ✓).
- Satır ipucu ✓: *"Sağ tık: bulunduğu klasörü aç · Çift tık: öğeyi aç"* ✓.

## Yeni IPC (bildirilmiş ✓ — motor komşusu dosyalara dokunuldu ✗)
`electron/preload.ts` ✓ → `showInFolder` `/` `openPath` ✓; `electron/main.ts` ✓ → iki `ipcMain.handle`
(`shell:showItem` ✓, `shell:openPath` ✓); `src/types.ts` ✓ → `XpAgentApi`'ye **isteğe bağlı** iki alan ✓.
**Güvenlik** ✓: ikisi de **yalnızca kullanıcının seçtiği yolu** açar ✓; yol boşsa `false` döner ve **hiçbir şey
yapmaz** ✗. Mevcut `logs:open` / `recovery:openReports` kalıbı **aynen** kullanıldı ✓.

## Değişmeyen
Döngü listesinin **düzenleme/önizleme** davranışı ✓, **checkbox/`startIndex`** ✓, **node ve akış JSON şeması** ✓,
**motor** (runner/agent/worker) davranışı ✓ — **değişmedi** ✗.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst ✗)
- **Bu iki jest + yeni IPC için test yazılmadı** ✗ (satır içi JSX işleyicileri ✓): yalnız **tip kontrolü + derleme +
  mevcut paketler** ✓.
- **Canlı Windows denemesi yapılmadı** ✗: (1) sağ tık menüsü **çıkıyor** mu ✓; (2) **“Yolu aç”** doğru klasörü
  açıp öğeyi **seçiyor** mu ✓; (3) **çift tık** GLB'yi varsayılan uygulamayla **açıyor** mu ✓;
  (4) listeyi **düzenleyen input** üzerinde sağ tıkta menü **çıkıyor** mu ✓ (olay satıra baloncukla ulaşır ✓ ve
  yerel menü bastırılır ✓ — ama **canlı denenmedi** ✗); (5) **göreli öğe + boş/şablon klasör** durumunda
  düğmeler **devre dışı** mı ✗✓.