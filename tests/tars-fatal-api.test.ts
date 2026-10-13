import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O04 (yönerge) — `tars` (görsel hedefleme) catch'i KALICI API hatasını yutmamalı.
 *
 * Ölçülen kusur: `agent.ts` görsel hedefleme dalının catch'i yalnız `StoppedError` ve
 * `VisualTargetRecoveryError`'ı yeniden fırlatıyordu. `FatalApiError` (`serviceFailure = true`,
 * openrouter.ts) bu yüzden "Görsel hedefleme atlandı" diye loglanıp akış `NotFoundError` ile sürüyordu →
 * runner'ın `serviceFailure` durdurma kuralı devreye girmiyor, bozuk anahtarla listenin TAMAMI öğe öğe
 * deneniyordu. Aynı dosyada 243/372 ve koşul dalı (586) `FatalApiError`'ı zaten fırlatır.
 *
 * Görsel hedefleme dalı canlı köprü/model gerektirdiği için bu dosya düzeltmenin KAYNAKTA kalıcı
 * olduğunu güvenceye alır; gerçek davranış (401/402 ile koşunun durması) canlı doğrulanmalıdır.
 */
const ham = readFileSync(fileURLToPath(new URL('../electron/agent.ts', import.meta.url)))
const kaynak = ham.includes(0) ? ham.toString('utf16le') : ham.toString('utf8')

describe('O04: görsel hedefleme kalıcı API hatasını yutar mı?', () => {
  const dal = (() => {
    const bas = kaynak.indexOf("log('info', 'Görsel model ekran görüntüsüne bakıyor.')")
    expect(bas).toBeGreaterThan(0)
    return kaynak.slice(bas, bas + 1400)
  })()

  it('FatalApiError yeniden fırlatılır (kalıcı API hatası hedef-yok’a dönüşmez)', () => {
    expect(dal).toContain('e instanceof FatalApiError')
    const firlatma = dal.indexOf('if (e instanceof StoppedError')
    const satir = dal.slice(firlatma, dal.indexOf('\n', firlatma))
    expect(satir).toContain('FatalApiError')
    expect(satir).toContain('throw e')
  })

  it('StoppedError ve VisualTargetRecoveryError davranışı korunur', () => {
    expect(dal).toContain('e instanceof StoppedError')
    expect(dal).toContain('e instanceof VisualTargetRecoveryError')
  })

  it('NotFoundError hâlâ yalnız uyarı olarak loglanır (aşırı düzeltme yok)', () => {
    expect(dal).toContain("if (e instanceof NotFoundError) log('warn', e.message)")
  })
})
