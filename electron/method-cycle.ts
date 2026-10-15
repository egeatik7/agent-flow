/** One complete method pass may fail; its owner repeats with fresh observations. */
export async function repeatMethodCycle<T>(attempt: (round: number) => Promise<T>, deps: {
  check: () => void
  wait: () => Promise<void>
  retry: (error: unknown, round: number) => void
  terminal?: (error: unknown) => boolean
}): Promise<T> {
  for (let round = 1; ; round++) {
    deps.check()
    try {
      const result = await attempt(round)
      deps.check()
      return result
    } catch (error) {
      deps.check()
      if (deps.terminal?.(error)) throw error
      deps.retry(error, round)
      await deps.wait()
    }
  }
}
export const methodErrorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** A valid, intentional model decision; never synthesized from a technical error. */
export class DeliberateStopError extends Error {
  readonly deliberateStop = true
}
