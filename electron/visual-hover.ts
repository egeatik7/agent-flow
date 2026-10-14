import type { ScanResult } from './matcher'

export type VisualPointerDecision = { decision: 'confirm' | 'adjust' | 'uncertain'; x?: number; y?: number; reason: string }
type Point = { x: number; y: number }
export type ApprovedPointer = Point & { hwnd: number; area: ScanResult['area'] }

export class VisualPointerError extends Error {
  readonly haltLoop = true
  constructor(message: string, readonly allowMethodFallback = false) { super(message) }
}

const validPoint = (p: Point | null | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 3

/** No input buttons here: at most one initial move and two corrections, each followed by a NEW frame. */
export async function alignVisualPointer(initial: Point, deps: {
  move: (point: Point) => Promise<{ hwnd?: number; warning?: string }>
  capture: () => Promise<ScanResult>
  position: () => Promise<Point | undefined>
  decide: (scan: ScanResult, pointer: Point) => Promise<VisualPointerDecision>
  checkStopped: () => void
  settle: () => Promise<void>
  stage: (text: string) => void
}): Promise<ApprovedPointer> {
  if (!validPoint(initial)) throw new VisualPointerError('Görsel hedef noktası geçersiz; tıklama gönderilmedi.')
  let point = initial
  for (let attempt = 0; attempt <= 2; attempt++) {
    deps.checkStopped()
    deps.stage(attempt ? `Görsel konum düzeltme ${attempt}/2` : 'Görsel hedefe fare hizalama')
    const moved = await deps.move(point)
    deps.checkStopped()
    if (!Number.isSafeInteger(moved.hwnd) || moved.hwnd! <= 0) throw new VisualPointerError('Fare altındaki pencere kimliği alınamadı; tıklama gönderilmedi.')
    await deps.settle()
    deps.checkStopped()
    const scan = await deps.capture()
    deps.checkStopped()
    const area = scan.area, cursor = scan.cursor
    if (!scan.image?.data || !validPoint(cursor) || ![area.x, area.y, area.w, area.h].every(Number.isFinite) || area.w <= 0 || area.h <= 0 ||
        cursor.x < area.x || cursor.y < area.y || cursor.x >= area.x + area.w || cursor.y >= area.y + area.h) {
      throw new VisualPointerError('Yeni görüntüde gerçek imleç işareti doğrulanamadı; tıklama gönderilmedi.')
    }
    if (!near(cursor, point)) throw new VisualPointerError('Fare hizalanan noktadan ayrıldı; tıklama gönderilmedi.')
    const before = await deps.position()
    deps.checkStopped()
    if (!validPoint(before) || !near(before, cursor)) throw new VisualPointerError('Fare yeni görüntüden sonra hareket etti; tıklama gönderilmedi.')
    deps.stage('Görsel konum doğrulama — model bekleniyor')
    const answer = await deps.decide(scan, cursor)
    deps.checkStopped()
    const current = await deps.position()
    deps.checkStopped()
    if (!validPoint(current) || !near(current, cursor)) throw new VisualPointerError('Model beklenirken fare hareket etti; onay kullanılmadı.')
    if (answer.decision === 'confirm') return { ...cursor, hwnd: moved.hwnd!, area }
    if (answer.decision !== 'adjust') throw new VisualPointerError(`Görsel model konumu onaylamadı${answer.reason ? `: ${answer.reason}` : ''}. Tıklama gönderilmedi.`, true)
    if (attempt === 2) throw new VisualPointerError('İki görsel konum düzeltmesinden sonra hedef onaylanmadı; tıklama gönderilmedi.', true)
    if (!Number.isFinite(answer.x) || !Number.isFinite(answer.y) || answer.x! < 0 || answer.x! >= 1 || answer.y! < 0 || answer.y! >= 1) {
      throw new VisualPointerError('Görsel düzeltme noktası geçersiz; tıklama gönderilmedi.', true)
    }
    point = { x: Math.round(area.x + answer.x! * area.w), y: Math.round(area.y + answer.y! * area.h) }
  }
  throw new VisualPointerError('Görsel konum doğrulanamadı.')
}
