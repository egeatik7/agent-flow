import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import type { CheckpointCursor } from '../electron/checkpoint-types'
import {
  CHECKPOINT_ROOTS_MAX,
  collectFlowPaths,
  commonAncestor,
  cursorVars,
  flowRoots,
  looksLikeFile,
  pathInText,
  staticPrefix,
} from '../electron/checkpoint-roots'

/**
 * 1.9.160 — DOSYA TAKİBİ KAPSAMI.
 *
 * Sınanan davranış: izlenecek kökler AKIŞTAN gelir (döngü `folder`'ı, öğe listesinin ortak
 * klasörü, yazı alanlarındaki yollar); tüm disk izlenmez, iç içe kökler tekilleşir, sistem
 * klasörleri atlanır ve sınır aşılmaz.
 */
const kok = path.join(os.tmpdir(), 'nubbo-roots-fixture')
const P = (...p: string[]) => path.join(kok, ...p)

const dongu = (over: Partial<AgentNode> = {}): AgentNode => Object.assign(createNode('loop', 0, 0), { title: 'Döngü' }, over)
const yazi = (text: string): AgentNode => Object.assign(createNode('type', 0, 0), { text })
const graf = (...nodes: AgentNode[]): AgentGraph => ({ nodes, edges: [] })
const imlec = (loops: CheckpointCursor['loops'] = [], scopes: CheckpointCursor['scopes'] = []): CheckpointCursor => ({ packagePath: [], loops, scopes })

describe('yol ayrıştırma (saf)', () => {
  it('serbest metindeki ilk mutlak yolu tırnaklardan temizler', () => {
    expect(pathInText('"C:\\NubboTools\\ProcessWatcher.exe"')).toBe('C:\\NubboTools\\ProcessWatcher.exe')
    expect(pathInText(`"${path.join(kok, 'Final Blends')}"`)).toBe(path.join(kok, 'Final Blends'))
    expect(pathInText(path.join(kok, 'Final Blends'))).toBe(path.join(kok, 'Final Blends'))
    expect(pathInText('Klasör: C:\\a\\b yaz')).toBe('C:\\a\\b')
    expect(pathInText('C:\\a\\b.glb.')).toBe('C:\\a\\b.glb')
    expect(pathInText('yol yok')).toBeNull()
    expect(pathInText('goreli\\yol\\x')).toBeNull()
  })

  it('çözülemeyen şablonun statik ön ekini verir', () => {
    expect(staticPrefix('C:\\Images\\{{öğe}}\\a.glb')).toBe('C:\\Images')
    expect(staticPrefix('C:\\Images')).toBe('C:\\Images')
    expect(staticPrefix('{{öğe}}\\a.glb')).toBeNull()
  })

  it('dosya ile klasörü ayırır', () => {
    for (const p of ['C:\\a\\m.glb', 'C:\\a\\p.blend', 'C:\\a\\x.exe']) expect(looksLikeFile(p)).toBe(true)
    for (const p of ['C:\\a\\Final Blends', 'C:\\a\\01', 'C:\\a\\Plug&Play', 'C:\\a\\']) expect(looksLikeFile(p)).toBe(false)
  })

  it('öğe listesinin ortak üst klasörünü bulur', () => {
    expect(commonAncestor(['C:\\W\\G\\01', 'C:\\W\\G\\02'])).toBe('C:\\W\\G')
    expect(commonAncestor(['C:\\W\\G\\a.glb', 'C:\\W\\G\\b.glb'])).toBe('C:\\W\\G')
    expect(commonAncestor(['C:\\W\\G\\a.glb'])).toBe('C:\\W\\G')
    expect(commonAncestor([])).toBeNull()
    expect(commonAncestor(['C:\\W\\A\\x', 'C:\\W\\B\\y'])).toBe('C:\\W')
  })

  it('imleçten öğe/sıra/toplam değişkenlerini üretir (iç kare dışı ezer)', () => {
    const vars = cursorVars(imlec(
      [{ id: 'out', keys: ['C:\\W\\G1', 'C:\\W\\G2'], index: 1, isList: true, outerVars: {} }],
      [{ path: [], vars: { sira: '9', ek: 'deger' } }],
    ))
    // `itemVars`/`renderTemplate` anahtarları normalize eder: {{öğe}} → 'oge', {{sıra}} → 'sira'.
    expect(vars.oge).toBe('C:\\W\\G2')
    expect(vars['oge.ad']).toBe('G2')
    expect(vars.sira).toBe('2')
    expect(vars.toplam).toBe('2')
    expect(vars.ek).toBe('deger')
  })
})

describe('akıştan yol toplama', () => {
  it('döngü klasörünü, öğelerin ortak klasörünü ve yazı alanındaki yolu bulur', () => {
    const g = graf(
      dongu({ folder: P('Images'), items: [P('Images', 'a.png'), P('Images', 'b.png')] }),
      // Gerçek akış: yazı alanında YALNIZ yol durur (boşluklu klasör adı dâhil).
      yazi(P('Final Blends')),
      Object.assign(createNode('package', 0, 0), { inner: graf(yazi(`"${P('OldGLBs')}"`)) }),
    )
    const paths = collectFlowPaths(g)
    const deger = paths.map(p => p.path)
    expect(deger).toContain(P('Images'))
    expect(deger).toContain(P('Final Blends'))
    expect(deger.some(p => p.includes('OldGLBs'))).toBe(true)
    expect(deger.some(p => p.includes('a.png'))).toBe(false) // öğeler çoğaltılmaz
  })
})

describe('kapsam: yalnız akışın bildirdiği klasörler', () => {
  it('iç içe kökleri tekilleştirir, dosya yolunun klasörünü izler', () => {
    const { roots } = flowRoots(graf(
      dongu({ folder: P('Groups'), items: [P('Groups', '01', 'a.glb')] }),
      yazi(`"${P('Groups', '01', 'out', 'x.blend')}"`),
    ))
    expect(roots).toEqual([P('Groups')])
  })

  it('şablonu imleçteki öğeyle çözer; çözemezse statik ön eki kullanır', () => {
    const g = graf(dongu({ folder: '{{öğe}}', items: [] }))
    const cozulen = flowRoots(g, imlec([{ id: 'L', keys: [P('G1'), P('G2')], index: 0, isList: true, outerVars: {} }]))
    expect(cozulen.roots).toContain(P('G1'))
    const cozulemeyen = flowRoots(graf(dongu({ folder: path.join(kok, '{{bilinmeyen}}') })))
    expect(cozulemeyen.roots).toContain(kok)
  })

  it('sistem/hariç klasörleri ve çıplak disk kökünü atlar', () => {
    const sistem = path.join(process.env.SystemRoot ?? 'C:\\Windows')
    const s = flowRoots(graf(yazi(sistem), yazi('C:\\')), undefined, { exclude: [sistem] })
    expect(s.roots).toEqual([])
    expect(s.skipped).toBeGreaterThan(0)
    // Disk kökü tek başına asla izlenmez (tüm disk izleme ayrı bir bayraktır).
    expect(flowRoots(graf(yazi('C:\\'))).roots).toEqual([])
  })

  it('kök sayısını sınırlar', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => yazi(`"${P(`Out${i}`)}"`))
    const { roots, skipped } = flowRoots(graf(...nodes))
    expect(roots.length).toBe(CHECKPOINT_ROOTS_MAX)
    expect(skipped).toBe(40 - CHECKPOINT_ROOTS_MAX)
  })

  it('gerçek akış biçimi: grup klasörleri + çıktı klasörleri (sürücü kökü DEĞİL)', () => {
    const g = graf(
      dongu({ folder: P('Remesh Gruplari'), items: [P('Remesh Gruplari', '01'), P('Remesh Gruplari', '02')] }),
      yazi(P('Final Blends')),
      yazi(P('OldGLBs')),
      yazi(P('HunyuanGLBs')),
    )
    const { roots } = flowRoots(g)
    expect(roots).toContain(P('Remesh Gruplari'))
    expect(roots).toContain(P('Final Blends'))
    expect(roots).toContain(P('OldGLBs'))
    expect(roots).toContain(P('HunyuanGLBs'))
    // Hiçbir kök sürücü kökü ya da ortak üst (kok) değildir.
    expect(roots).not.toContain(kok)
    expect(roots.every(r => r.startsWith(kok))).toBe(true)
  })

  it('göreli yolu atlar, mutlak olanı alır', () => {
    const g = graf(dongu({ folder: 'goreli\\klasor' }), yazi(`"${P('Mutlak')}"`))
    const { roots, skipped } = flowRoots(g)
    expect(roots).toEqual([P('Mutlak')])
    expect(skipped).toBeGreaterThanOrEqual(1)
  })
})
