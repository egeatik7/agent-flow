/**
 * "Kimse ekranı kullanmuyor mu?" — koşudan önce sorulur.
 *
 * Bu döngü motorun kendisini çağırdığı için gerçek fareyi ve klavyeyi kullanır. İnsan o sırada
 * bilgisayarda bir şey yapıyorsa koşu onun odağını ve tıklamasını çalar. Bu yüzden her masaüstü
 * koşusundan önce son girdiden bu yana geçen süre ölçülür ve insan yakın zamanda bir şeye
 * dokunduysa koşu BAŞLATILMAZ.
 *
 * Kullanım:
 *   node scripts/dev-idle.cjs [--need 60000] [--json]
 *
 * Çıkış kodu: 0 → ekran boş, koşulabilir · 4 → insan az önce dokundu, koşma.
 */
const { execFileSync } = require('child_process')

const args = process.argv.slice(2)
const needIdx = args.indexOf('--need')
const need = needIdx >= 0 ? Number(args[needIdx + 1]) : 60000
const asJson = args.includes('--json')

function idleMs() {
  // GetLastInputInfo: sistemin tamamı için son girdinin zamanı (ms).
  const ps = [
    'Add-Type -Namespace N -Name U -MemberDefinition \'[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\';',
    '$i = New-Object N.U+LASTINPUTINFO; $i.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($i);',
    '$null = [N.U]::GetLastInputInfo([ref]$i);',
    '$tick = [Environment]::TickCount;',
    '[int]($tick - $i.dwTime)',
  ].join(' ')
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  const n = Number(String(out).trim().split(/\r?\n/).pop())
  return Number.isFinite(n) ? n : -1
}

const idle = idleMs()
const busy = idle >= 0 && idle < need
const result = {
  idleMs: idle,
  needed: need,
  free: !busy,
  message: busy
    ? `Ekran şu an kullanılıyor (son girdiden ${Math.round(idle / 1000)} sn geçti, ${Math.round(need / 1000)} sn gerekiyor). Koşu başlatılmadı.`
    : idle < 0
      ? 'Girdi zamanı okunamadı; güvenli tarafta kalınıyor.'
      : `Ekran boş (son girdiden ${Math.round(idle / 1000)} sn geçti). Koşulabilir.`,
}

if (asJson) console.log(JSON.stringify(result, null, 2))
else console.log(`  ${busy || idle < 0 ? '✗' : '✓'} ${result.message}`)

process.exit(result.free ? 0 : 4)
