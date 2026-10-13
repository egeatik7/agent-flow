/** Per-condition cancellation. Does not replace the application's user-stop flag. */
export class ObservationTimeoutError extends Error {
  constructor() { super('Koşul gözlem süresi doldu.'); this.name = 'ObservationTimeoutError' }
}
export type ObservationOptions = { signal?: AbortSignal }
export function checkObservation(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new ObservationTimeoutError()
}
/** Settles even when a reader does not implement native cancellation; late results are ignored. */
export async function observeWithin<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  if (signal.aborted) { void work.catch(() => {}); checkObservation(signal) }
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason instanceof Error ? signal.reason : new ObservationTimeoutError()); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([work, cancelled]) }
  finally {
    signal.removeEventListener('abort', abort)
    void work.catch(() => {})
  }
}
