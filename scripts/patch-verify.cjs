#!/usr/bin/env node
/**
 * Cerrahi yama 4 (son): ensureActed'in başına "off" erken çıkışı ve mod okuması + ayarın testi.
 * Satır tabanlı; her ekleme tam bir kez, sonunda doğrulanır.
 */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
let hata = 0

// 1) agent.ts: mod okuması ve "off" erken çıkışı
{
  const tam = path.join(root, 'electron/agent.ts')
  const satirlar = fs.readFileSync(tam, 'utf8').split('\n')
  if (satirlar.some((s) => s.includes('const mode = screenCheckMode(getSettings())'))) {
    console.log('• agent.ts: mod okuması zaten var')
  } else {
    const i = satirlar.findIndex((s) => s.includes('async function ensureActed('))
    if (i < 0) {
      console.error('✗ agent.ts: ensureActed bulunamadı')
      hata++
    } else {
      const girinti = '      '
      const ekle = [
        `${girinti}// CLAUDE.md §17: the decision is log-only by default, and "off" means the action is taken`,
        `${girinti}// at its word - no screen scans, no waiting and no model calls. This is the answer to the`,
        `${girinti}// cost the decision note describes, and why the threshold is not being tuned again.`,
        `${girinti}const mode = screenCheckMode(getSettings())`,
        `${girinti}if (mode === 'off') {`,
        `${girinti}  await act()`,
        `${girinti}  return true`,
        `${girinti}}`,
      ]
      satirlar.splice(i + 1, 0, ...ekle)
      fs.writeFileSync(tam, satirlar.join('\n'), 'utf8')
      console.log(`✓ agent.ts: mod okuması + "off" erken çıkışı eklendi (satır ${i + 2})`)
    }
  }
}

// 2) Test: ayarın sözleşmesi
{
  const tam = path.join(root, 'tests/bug-hunt-2.test.ts')
  let metin = fs.readFileSync(tam, 'utf8')
  if (metin.includes('ekran doğrulama ayarı')) {
    console.log('• test zaten var')
  } else {
    if (!metin.includes('DEFAULT_SETTINGS')) {
      metin = metin.replace(
        "import { createNode, baseName, itemVars, listItems, loopKeys, loopStartIndex, type AgentGraph, type AgentNode } from '../electron/graph-types'",
        "import { createNode, baseName, itemVars, listItems, loopKeys, loopStartIndex, screenCheckMode, DEFAULT_SETTINGS, type AgentGraph, type AgentNode } from '../electron/graph-types'"
      )
    }
    metin += `
describe('derin batarya: ekran doğrulama ayarı (CLAUDE.md §17)', () => {
  it('varsayılan yalnızca günlük; bilinmeyen değer sessizce açılmaz', () => {
    // §17 kararı: doğrulama varsayılan olarak yalnızca-günlük çalışır ve eşik ayarı denenmez.
    expect(DEFAULT_SETTINGS.screenCheck).toBe('log')
    expect(screenCheckMode(DEFAULT_SETTINGS)).toBe('log')
    expect(screenCheckMode(undefined)).toBe('log')
    expect(screenCheckMode({})).toBe('log')
    expect(screenCheckMode({ screenCheck: 'off' })).toBe('off')
    expect(screenCheckMode({ screenCheck: 'on' })).toBe('on')
    // Eski bir kayıtta tanınmayan bir değer varsa sessizce "açık" olmaz (model çağrısı harcamaz).
    expect(screenCheckMode({ screenCheck: 'kapali' })).toBe('log')
    expect(screenCheckMode({ screenCheck: 'ON' })).toBe('log')
  })
})
`
    fs.writeFileSync(tam, metin, 'utf8')
    console.log('✓ tests/bug-hunt-2.test.ts: ayar testi eklendi')
  }
}

// Doğrulama
const at = fs.readFileSync(path.join(root, 'electron/agent.ts'), 'utf8')
const tt = fs.readFileSync(path.join(root, 'tests/bug-hunt-2.test.ts'), 'utf8')
const say = (s, n) => s.split(n).length - 1
console.log('\n— doğrulama —')
console.log(`  agent.ts: const mode ${say(at, 'const mode = screenCheckMode(getSettings())')} · off-dalı ${say(at, "mode === 'off'")} · log-dalı ${say(at, "mode === 'log'")} · on-dalı ${say(at, "mode === 'on' && expected")} · lookCloser ${say(at, 'lookCloser(verdict')}`)
console.log(`  test: ${say(tt, 'ekran doğrulama ayarı') >= 1 ? 'var' : 'yok'}`)
const tamam = say(at, 'const mode = screenCheckMode(getSettings())') === 1 && say(at, "mode === 'off'") === 1 && say(at, "mode === 'log'") === 1 && say(at, "mode === 'on' && expected") === 1 && say(tt, 'ekran doğrulama ayarı') === 1
console.log(tamam && !hata ? '\nYapı doğru' : `\n✗ yapı beklendiği gibi değil (hata=${hata})`)
process.exit(tamam && !hata ? 0 : 1)
