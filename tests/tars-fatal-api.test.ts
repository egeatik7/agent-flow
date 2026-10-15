import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Technical API failure now advances methods; it may not end or skip the item. */
const ham = readFileSync(fileURLToPath(new URL('../electron/agent.ts', import.meta.url)))
const kaynak = ham.includes(0) ? ham.toString('utf16le') : ham.toString('utf8')

describe('O04: görsel hedefleme kalıcı API hatasını yutar mı?', () => {
  const dal = (() => {
    const bas = kaynak.indexOf("log('info', 'Görsel model ekran görüntüsüne bakıyor.')")
    expect(bas).toBeGreaterThan(0)
    return kaynak.slice(bas, bas + 1400)
  })()

  it('API hatası diğer açık yöntemlerin önünü kapatmaz', () => {
    expect(dal).toContain('sıradaki yöntem denenecek')
    const firlatma = dal.indexOf('if (e instanceof StoppedError')
    const satir = dal.slice(firlatma, dal.indexOf('\n', firlatma))
    expect(satir).not.toContain('FatalApiError')
    expect(satir).toContain('throw e')
  })

  it('StoppedError ve VisualTargetRecoveryError davranışı korunur', () => {
    expect(dal).toContain('e instanceof StoppedError')
    expect(dal).toContain('e instanceof VisualTargetRecoveryError')
  })

  it('NotFoundError hâlâ yalnız uyarı olarak loglanır (aşırı düzeltme yok)', () => {
    expect(dal).toContain("methodErrors.push(e.message); log('warn', e.message)")
  })
})
