import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type LogLevel } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++edgeNo}`, from: from.id, fromPort, to: to.id })
const typeNode = (text: string) => {
  const n = createNode('type', 0, 0)
  n.text = text
  return n
}
const opts = { maxSteps: 100, stepDelayMs: 0 }

/** Sahte yürütücü: gerçek ekran yok, Yazı Yaz node'larının işlenmiş metnini toplar. */
function fakeExecutor() {
  const typed: string[] = []
  const logs: { level: LogLevel; message: string }[] = []
  const ex: Executor = {
    log: (level, message) => logs.push({ level, message }),
    step: () => {},
    shouldStop: () => false,
    click: async () => {},
    type: async (node) => {
      typed.push(node.text ?? '')
    },
    key: async () => {},
    exists: async () => true,
  }
  return { ex, typed, logs }
}

// Üç gerçek klasör; her birinde klasöre özgü adlı iki dosya, hangi turda hangi klasörün okunduğu görünsün diye.
let base = ''
let folders: string[] = []
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-vars-'))
  folders = ['Klasor1', 'Klasor2', 'Klasor3'].map((f) => path.join(base, f))
  for (const f of folders) {
    fs.mkdirSync(f)
    fs.writeFileSync(path.join(f, `a-${path.basename(f)}.txt`), '')
    fs.writeFileSync(path.join(f, `b-${path.basename(f)}.txt`), '')
  }
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

/**
 * Dış döngü (3 klasör)
 *   └ Paket
 *       ├ Yazı Yaz  KLASOR={{öğe.ad}} SIRA={{sıra}}/{{toplam}}      (paketin içinde, iç döngünün dışında)
 *       ├ İç döngü  (klasör: {{öğe}})
 *       │   └ Yazı Yaz  DOSYA={{öğe.ad}} #{{sıra}}/{{toplam}}
 *       └ Yazı Yaz  FIN={{öğe.ad}}                                   (iç döngüden sonra)
 */
function scenario() {
  const start = createNode('start', 0, 0)
  const outer = createNode('loop', 100, 0)
  outer.items = folders
  const pkg = createNode('package', 200, 0)
  outer.members = [pkg.id]
  const pkgType = typeNode('KLASOR={{öğe.ad}} SIRA={{sıra}}/{{toplam}}')
  const inner = createNode('loop', 100, 0)
  inner.folder = '{{öğe}}'
  const innerType = typeNode('DOSYA={{öğe.ad}} #{{sıra}}/{{toplam}}')
  inner.members = [innerType.id]
  const pkgAfter = typeNode('FIN={{öğe.ad}}')
  pkg.inner = { nodes: [pkgType, inner, innerType, pkgAfter], edges: [edge(pkgType, 'next', inner), edge(inner, 'done', pkgAfter)] }
  const graph: AgentGraph = { nodes: [start, outer, pkg], edges: [edge(start, 'next', outer)] }
  return { graph, outer, pkg, pkgType, inner, innerType }
}

const lap = (n: number) => [
  `KLASOR=Klasor${n} SIRA=${n}/3`,
  `DOSYA=a-Klasor${n}.txt #1/2`,
  `DOSYA=b-Klasor${n}.txt #2/2`,
  `FIN=Klasor${n}`,
]

describe('paket içinde dış döngünün değişkenleri', () => {
  it('her dış turda paketin içindeki node o turun öğesini, sırasını ve toplamını görür', async () => {
    const { graph } = scenario()
    const { ex, typed } = fakeExecutor()
    await runGraph(graph, ex, opts)
    expect(typed).toEqual([...lap(1), ...lap(2), ...lap(3)])
  })

  it('sayıyla çalışan dış döngüde de ({{öğe}} = tur numarası)', async () => {
    const start = createNode('start', 0, 0)
    const outer = createNode('loop', 100, 0)
    outer.count = 2
    const pkg = createNode('package', 200, 0)
    outer.members = [pkg.id]
    pkg.inner = { nodes: [typeNode('{{öğe}}/{{toplam}}')], edges: [] }
    const { ex, typed } = fakeExecutor()
    await runGraph({ nodes: [start, outer, pkg], edges: [edge(start, 'next', outer)] }, ex, opts)
    expect(typed).toEqual(['1/2', '2/2'])
  })

  it('paket içinde paket: değişkenler iki katman da geçer', async () => {
    const start = createNode('start', 0, 0)
    const outer = createNode('loop', 100, 0)
    outer.items = folders
    const outerPkg = createNode('package', 200, 0)
    outer.members = [outerPkg.id]
    const innerPkg = createNode('package', 0, 0)
    innerPkg.inner = { nodes: [typeNode('{{öğe.ad}}')], edges: [] }
    outerPkg.inner = { nodes: [innerPkg], edges: [] }
    const { ex, typed } = fakeExecutor()
    await runGraph({ nodes: [start, outer, outerPkg], edges: [edge(start, 'next', outer)] }, ex, opts)
    expect(typed).toEqual(['Klasor1', 'Klasor2', 'Klasor3'])
  })
})

describe('eski davranış korunur', () => {
  it('döngü dışındaki paket eskisi gibi: sıra 1, tanımsız değişkenler olduğu gibi kalır', async () => {
    const start = createNode('start', 0, 0)
    const pkg = createNode('package', 100, 0)
    pkg.inner = { nodes: [typeNode('{{öğe.ad}} {{sıra}}/{{toplam}}')], edges: [] }
    const { ex, typed } = fakeExecutor()
    await runGraph({ nodes: [start, pkg], edges: [edge(start, 'next', pkg)] }, ex, opts)
    expect(typed).toEqual(['{{öğe.ad}} 1/{{toplam}}'])
  })

  it('paketsiz iç içe döngüler: en içteki öğe kazanır', async () => {
    const start = createNode('start', 0, 0)
    const inner = createNode('loop', 150, 50)
    inner.count = 2
    const leaf = typeNode('{{öğe}}')
    inner.members = [leaf.id]
    const outer = createNode('loop', 100, 0)
    outer.items = ['x', 'y']
    outer.members = [inner.id]
    const { ex, typed } = fakeExecutor()
    await runGraph({ nodes: [start, outer, inner, leaf], edges: [edge(start, 'next', outer)] }, ex, opts)
    expect(typed).toEqual(['1', '2', '1', '2'])
  })
})

describe('paketin içinden başlatma ve kaldığı yerden devam', () => {
  it('paketin ilk node\'undan başlatınca dış turun değişkenleri gelir, sonra kalan dış turlar sürer', async () => {
    const { graph, outer, pkg, pkgType } = scenario()
    outer.startIndex = 1 // Klasor2 turundayız
    const { ex, typed } = fakeExecutor()
    await runGraph(graph, ex, { ...opts, packagePath: [pkg.id], startId: pkgType.id, resume: true })
    expect(typed).toEqual([...lap(2), ...lap(3)])
  })

  it('iç döngünün ortasından devam: kalan dosya, iç döngüden sonraki node ve kalan dış tur', async () => {
    const { graph, outer, inner, innerType, pkg } = scenario()
    outer.startIndex = 1
    inner.startIndex = 1 // iç döngüde ikinci dosyadayız
    const { ex, typed } = fakeExecutor()
    await runGraph(graph, ex, { ...opts, packagePath: [pkg.id], startId: innerType.id, resume: true })
    expect(typed).toEqual(['DOSYA=b-Klasor2.txt #2/2', 'FIN=Klasor2', ...lap(3)])
  })
})
