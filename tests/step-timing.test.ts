import { describe, expect, it } from 'vitest'
import { beginStepTiming, endStepTiming, recordTiming, StepTiming } from '../electron/step-timing'

/** A clock the test moves by hand, so totals are exact. */
function fakeClock(start = 1000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('StepTiming', () => {
  it('sums each kind and counts its samples', () => {
    const clock = fakeClock()
    const t = new StepTiming('Tıkla “Kaydet”', clock.now)
    t.add('wait', 900)
    t.add('wait', 2000)
    t.add('scan', 120)
    t.add('model', 4500)
    t.add('model', 800)
    clock.advance(8000)
    expect(t.line()).toBe('Süre: “Tıkla “Kaydet”” toplam 8000 ms · bekleme 2900 ms (2×) · tarama 120 ms (1×) · model 5300 ms (2×)')
  })

  it('shows zero counts for kinds that never happened', () => {
    const clock = fakeClock()
    const t = new StepTiming('Bekle', clock.now)
    clock.advance(10)
    expect(t.line()).toBe('Süre: “Bekle” toplam 10 ms · bekleme 0 ms (0×) · tarama 0 ms (0×) · model 0 ms (0×)')
  })

  it('ignores negative durations instead of subtracting time', () => {
    const t = new StepTiming('x', fakeClock().now)
    t.add('wait', -50)
    expect(t.line()).toContain('bekleme 0 ms (1×)')
  })
})

describe('current step recording', () => {
  it('records only while a step is active', () => {
    const clock = fakeClock()
    recordTiming('model', 999) // no active step: must not throw, must not leak into the next step
    const t = beginStepTiming('Yaz', clock.now)
    recordTiming('scan', 40)
    clock.advance(50)
    expect(endStepTiming(t)).toContain('tarama 40 ms (1×)')
    recordTiming('scan', 777) // after the end: dropped
    const next = beginStepTiming('Sonraki', clock.now)
    expect(endStepTiming(next)).toContain('tarama 0 ms (0×)')
  })

  it('clears the current step on end, so a stale timer cannot collect samples', () => {
    const clock = fakeClock()
    const a = beginStepTiming('A', clock.now)
    endStepTiming(a)
    recordTiming('wait', 100)
    expect(endStepTiming(a)).toContain('bekleme 0 ms (0×)')
  })
})
