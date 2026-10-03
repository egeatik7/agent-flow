import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseTypeField, FatalApiError, ModelFailed, ModelRejected, runModelChain, setStopCheck } from '../electron/openrouter'
import { StoppedError } from '../electron/runner'

afterEach(() => {
  setStopCheck(() => false)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runModelChain: kalıcı ret sınırı', () => {
  it('her model 8 tur üst üste kalıcı reddedilirse net bir hata verir', async () => {
    const run = vi.fn(async (model: string) => {
      throw new ModelRejected(`${model}: OpenRouter 404`)
    })
    await expect(runModelChain(['a', 'b'], run, 0)).rejects.toThrow(/Hiçbir model cevap vermedi: 8 tur üst üste/)
    expect(run).toHaveBeenCalledTimes(16)
  })

  it('geçici hatalarda (ModelFailed) vazgeçmez, 8 turdan sonra da dener', async () => {
    let calls = 0
    const run = async () => {
      calls++
      if (calls <= 40) throw new ModelFailed('OpenRouter 429')
      return 'tamam'
    }
    await expect(runModelChain(['a', 'b'], run, 0)).resolves.toBe('tamam')
    expect(calls).toBe(41)
  })

  it('bir turda bile geçici hata varsa kalıcı-ret sayacı sıfırlanır', async () => {
    let calls = 0
    const run = async (model: string) => {
      calls++
      if (calls > 40) return 'tamam'
      // a her zaman kalıcı reddediyor, b geçici hata veriyor: tur "hepsi kalıcı" sayılmaz
      if (model === 'a') throw new ModelRejected('a: 404')
      throw new ModelFailed('b: 429')
    }
    await expect(runModelChain(['a', 'b'], run, 0)).resolves.toBe('tamam')
  })

  it('7 kalıcı tur, 1 geçici tur, 7 kalıcı tur: sayaç sıfırlandığı için durmaz', async () => {
    let calls = 0
    // tek modelli zincir: her çağrı bir tur
    const run = async () => {
      calls++
      if (calls === 16) return 'tamam'
      if (calls === 8) throw new ModelFailed('429')
      throw new ModelRejected('404')
    }
    await expect(runModelChain(['a'], run, 0)).resolves.toBe('tamam')
  })

  it('anahtar/bakiye hatasında (FatalApiError) hemen durur', async () => {
    const run = vi.fn(async () => {
      throw new FatalApiError('401')
    })
    await expect(runModelChain(['a', 'b'], run, 0)).rejects.toBeInstanceOf(FatalApiError)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('kullanıcı durdurunca StoppedError verir', async () => {
    setStopCheck(() => true)
    const run = vi.fn(async () => 'x')
    await expect(runModelChain(['a'], run, 0)).rejects.toBeInstanceOf(StoppedError)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('HTTP durum koduna göre sınıflandırma (sahte fetch, sahte saat)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  const ask = () =>
    chooseTypeField({
      apiKey: 'k',
      model: ['yanlis/model'],
      step: 'Yazı Yaz',
      instruction: '',
      text: 'abc',
      ahead: '',
      choices: [{ id: 1, window: 'W', type: 'Edit', name: '', value: '', clicked: false }],
    })

  it('404 (yanlış model adı) yaklaşık yarım dakikada net hataya döner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => 'no such model' })))
    const result = ask().then(
      () => 'çözüldü',
      (e: Error) => e.message
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await result).toMatch(/Hiçbir model cevap vermedi/)
  })

  it('429 (yoğunluk) 10 dakika sonra bile vazgeçmeden beklemeye devam eder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })))
    let settled = false
    ask().then(
      () => (settled = true),
      () => (settled = true)
    )
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(settled).toBe(false)
    setStopCheck(() => true) // arka planda dönen denemeyi bitir
    await vi.advanceTimersByTimeAsync(10_000)
  })

  it('401 (geçersiz anahtar) hemen durur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' })))
    const result = ask().then(
      () => 'çözüldü',
      (e: Error) => e.constructor.name
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await result).toBe('FatalApiError')
  })
})
