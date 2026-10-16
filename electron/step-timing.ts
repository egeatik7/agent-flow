/**
 * Per-node timing, log only. Counts how long one executor step waited, scanned the screen and waited
 * for model HTTP requests. It never changes what a step does: the only output is one log line.
 */
export type TimingKind = 'wait' | 'scan' | 'model'

export class StepTiming {
  private readonly totals: Record<TimingKind, number> = { wait: 0, scan: 0, model: 0 }
  private readonly counts: Record<TimingKind, number> = { wait: 0, scan: 0, model: 0 }
  private readonly startedAt: number

  constructor(readonly label: string, private readonly clock: () => number = () => Date.now()) {
    this.startedAt = clock()
  }

  add(kind: TimingKind, ms: number): void {
    this.totals[kind] += Math.max(0, ms)
    this.counts[kind] += 1
  }

  /** One line, Turkish, fixed order so logs can be compared between runs. */
  line(): string {
    const total = Math.max(0, this.clock() - this.startedAt)
    const part = (name: string, kind: TimingKind) => `${name} ${Math.round(this.totals[kind])} ms (${this.counts[kind]}×)`
    return `Süre: “${this.label}” toplam ${Math.round(total)} ms · ${part('bekleme', 'wait')} · ${part('tarama', 'scan')} · ${part('model', 'model')}`
  }
}

let current: StepTiming | undefined

/** Starts timing a step. The previous step, if any, is replaced; steps do not nest. */
export function beginStepTiming(label: string, clock?: () => number): StepTiming {
  current = new StepTiming(label, clock)
  return current
}

/** Ends the step and returns its line. Clears the current timer only if it is still this one. */
export function endStepTiming(timing: StepTiming): string {
  if (current === timing) current = undefined
  return timing.line()
}

/** Adds a measured duration to the running step. Does nothing outside a step. */
export function recordTiming(kind: TimingKind, ms: number): void {
  current?.add(kind, ms)
}
