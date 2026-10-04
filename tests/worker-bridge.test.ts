import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sahte PowerShell worker'ı: gerçek süreç yok. Test ne zaman READY diyeceğini ve hangi isteğe ne zaman cevap vereceğini seçer.
const h = await vi.hoisted(async () => {
  const { EventEmitter } = await import('events')
  const { PassThrough } = await import('stream')
  class FakeProc extends EventEmitter {
    stdin = new PassThrough()
    stdout = new PassThrough()
    stderr = new PassThrough()
    killed = false
    written = ''
    constructor() {
      super()
      this.stdin.on('data', (d) => (this.written += String(d)))
    }
    kill() {
      if (!this.killed) {
        this.killed = true
        this.emit('exit', null)
      }
      return true
    }
    say(line: string) {
      this.stdout.write(line + '\n')
    }
    /** Requests written so far: `<id>\t<op>\t<base64 payload>` per line. */
    requests() {
      return this.written
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [id, op] = l.split('\t')
          return { id, op }
        })
    }
    answer(id: string, data: unknown) {
      this.say(`${id}\t${Buffer.from(JSON.stringify({ ok: true, data })).toString('base64')}`)
    }
  }
  const spawned: FakeProc[] = []
  return { FakeProc, spawned }
})

vi.mock('child_process', () => ({
  spawn: () => {
    const p = new h.FakeProc()
    h.spawned.push(p)
    return p
  },
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))
vi.mock('../electron/ocr-onnx', () => ({
  mergeOnnxLines: () => [],
  onnxError: () => '',
  readRawShot: () => null,
  recognizeBgra: async () => [],
  recognizeSideways: async () => [],
  warmOnnx: async () => {},
}))

import * as bridge from '../electron/a11y-bridge'

const flush = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0)
}

describe.skipIf(process.platform !== 'win32')('worker köprüsü', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.spawned.length = 0
  })
  afterEach(() => {
    bridge.shutdown()
    vi.useRealTimers()
  })

  it('açılış 60 sn içinde bitmezse takılan süreç öldürülür ve sonraki çağrı yeniden başlatır', async () => {
    const first = bridge.clickAt(1, 1)
    const failed = expect(first).rejects.toThrow(/başlamadı/)
    await vi.advanceTimersByTimeAsync(61_000)
    await failed
    expect(h.spawned[0].killed).toBe(true)

    const second = bridge.clickAt(2, 2)
    await flush()
    expect(h.spawned.length).toBe(2) // eskiden kalıcı bozuluyordu: yeni süreç hiç açılmıyordu
    h.spawned[1].say('READY')
    await flush()
    h.spawned[1].answer(h.spawned[1].requests()[0].id, true)
    await expect(second).resolves.toBeUndefined()
  })

  it('PowerShell hiç başlatılamazsa (spawn error) sonraki çağrı yeniden dener', async () => {
    const first = bridge.clickAt(1, 1)
    const failed = expect(first).rejects.toThrow(/başlatılamadı/)
    await flush()
    h.spawned[0].emit('error', new Error('ENOENT'))
    await failed

    const second = bridge.clickAt(2, 2)
    await flush()
    expect(h.spawned.length).toBe(2)
    h.spawned[1].say('READY')
    await flush()
    h.spawned[1].answer(h.spawned[1].requests()[0].id, true)
    await expect(second).resolves.toBeUndefined()
  })

  it('uzun bir işin arkasında bekleyen kısa istek, sağlıklı worker\'ı zaman aşımıyla öldürmez', async () => {
    const click = bridge.clickAt(5, 5) // worker meşgul olacak (60 sn sınırı)
    await flush()
    h.spawned[0].say('READY')
    await flush()
    const fg = bridge.foreground() // 10 sn sınırlı, ilk işin ARKASINDA bekliyor
    await vi.advanceTimersByTimeAsync(30_000) // worker 30 sn meşgul: kısa isteğin 10 sn'si bu bekleme yüzünden dolmamalı
    expect(h.spawned[0].killed).toBe(false)
    expect(h.spawned[0].requests().length).toBe(1) // sıradaki istek, ilki bitmeden worker'a yazılmaz

    h.spawned[0].answer(h.spawned[0].requests()[0].id, true)
    await click
    await flush()
    expect(h.spawned[0].requests().length).toBe(2)
    h.spawned[0].answer(h.spawned[0].requests()[1].id, { title: 'Pencere', pid: 7 })
    await expect(fg).resolves.toEqual({ title: 'Pencere', pid: 7 })
    expect(h.spawned.length).toBe(1) // aynı worker, yeniden başlatılmadı
  })

  it('cevap vermeyen worker zaman aşımında öldürülür, sonraki çağrı yenisini açar', async () => {
    const click = bridge.clickAt(1, 1)
    await flush()
    h.spawned[0].say('READY')
    await flush()
    const failed = expect(click).rejects.toThrow(/zaman aşımı/)
    await vi.advanceTimersByTimeAsync(61_000)
    await failed
    expect(h.spawned[0].killed).toBe(true)

    const next = bridge.clickAt(2, 2)
    await flush()
    expect(h.spawned.length).toBe(2)
    h.spawned[1].say('READY')
    await flush()
    h.spawned[1].answer(h.spawned[1].requests()[0].id, true)
    await expect(next).resolves.toBeUndefined()
  })

  it('worker kapanmışken yazmak (stdin hatası) uygulamayı çökertmez', async () => {
    const click = bridge.clickAt(1, 1)
    await flush()
    h.spawned[0].say('READY')
    await flush()
    expect(() => h.spawned[0].stdin.emit('error', new Error('EPIPE'))).not.toThrow()
    h.spawned[0].kill()
    await expect(click).rejects.toThrow()
  })
})
