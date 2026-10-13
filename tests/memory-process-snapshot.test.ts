import { describe, expect, it } from 'vitest'
import { olcumKur, surecKayitlariniGrupla, sayiYaNull } from '../electron/memory-meter'

const GB = 1024 ** 3
const row = (pid: number, parentId: number | null, name: string, pb = .05, ws = .05) =>
  ({ pid, parentId, name, privateBayt: pb * GB, workingSetBayt: ws * GB })

describe('actual PID snapshots include model runners', () => {
  it('includes detached llama-server even when the two small Ollama roots exist', () => {
    const o = olcumKur({ surecler: [row(10, 1, 'ollama'), row(11, 1, 'ollama app'), row(20, 99, 'llama-server', 9.3, 7)] }, [], 1, 1)
    expect(o.model?.adet).toBe(3)
    expect(o.model?.privateBayt).toBeCloseTo(9.4 * GB)
    expect(o.model?.workingSetBayt).toBeCloseTo(7.1 * GB)
    expect(o.digerCalistiricilar).toEqual([])
    expect(o.notlar.join(' ')).toContain('1 ağaç dışı')
  })
  it('counts an attached runner once and follows descendants with different names', () => {
    const r = row(20, 10, 'llama-server', 9.3, 7)
    const o = surecKayitlariniGrupla([row(10, 1, 'ollama'), r, { ...r }, row(30, 20, 'worker', 1, 1), row(99, 1, 'opera', 4, 4)])
    expect(o.model?.adet).toBe(3)
    expect(o.model?.privateBayt).toBeCloseTo(10.35 * GB)
    expect(o.notlar).toEqual([])
  })
  it('falls back to recognized runners when parent lookup failed', () => {
    expect(surecKayitlariniGrupla([row(20, null, 'LLAMA-SERVER.exe', 9, 7)]).model).toMatchObject({ adet: 1, kaynak: 'isim', privateBayt: 9 * GB })
  })
  it('does not reuse a runner that disappeared in the next snapshot', () => {
    expect(olcumKur({ surecler: [row(20, 10, 'llama-server', 9, 7)] }, [], 1, 1).model?.adet).toBe(1)
    expect(olcumKur({ surecler: [] }, [], 2, 1).model).toBeNull()
  })
  it('does not publish a partial numeric sum when a selected counter is unavailable', () => {
    const o = surecKayitlariniGrupla([row(10, 1, 'ollama'), { ...row(20, 10, 'llama-server'), privateBayt: null }])
    expect(o.model?.privateBayt).toBeNull()
    expect(o.model?.metin).toContain('commit bilinmiyor')
  })
  it('keeps Blender separate and does not turn process totals into system commit', () => {
    const o = olcumKur({ surecler: [row(20, null, 'llama-server', 9, 7), row(40, 1, 'Blender.exe', 8, 6)] }, [], 1, 1)
    expect(o.model?.privateBayt).toBe(9 * GB)
    expect(o.blender?.privateBayt).toBe(8 * GB)
    expect(o.sunucu.commitKullanilanBayt).toBeNull()
  })
  it('missing counters remain unknown instead of Number(null) becoming zero', () => {
    for (const value of [null, undefined, '', ' ', false, true]) expect(sayiYaNull(value)).toBeNull()
    expect(sayiYaNull(0)).toBe(0)
  })
})
