import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `kk${++edgeNo}`, from: from.id, fromPort, to: to.id })
const opts = { maxSteps: 200, stepDelayMs: 0 }

const kok = path.join(os.tmpdir(), 'nubbo-kabul-testi')
const k1 = path.join(kok, 'var1')
const k2 = path.join(kok, 'var2')
const k3 = path.join(kok, 'var3')

beforeAll(() => {
  fs.rmSync(kok, { recursive: true, force: true })
  for (const k of [k1, k2, k3]) {
    fs.mkdirSync(k, { recursive: true })
    fs.writeFileSync(path.join(k, 'a.txt'), 'a', 'utf8')
    fs.writeFileSync(path.join(k, 'b.txt'), 'b', 'utf8')
  }
})

/**
 * #5 — TAMAMLANAN KUTU YENİDEN BAŞLAMAMALI.
 *
 * Kabul fikstürünün tam şekli: dış kutu (3 klasör öğesi) → iç kutu (klasör = {{öğe}}, üyesi: bekle).
 * İÇ KUTUNUN ÇIKIŞ KENARI YOKTUR (kullanıcı akışlarında olağan: tur zinciri kutunun içinde biter).
 *
 * Ölçülen kusur: bu şekilde dış kutu BİTMİYOR, baştan başlıyordu — canlı koşuda 2. ve 3. öğe
 * 149 kez çalıştı (tekrar), buna karşılık hata sayacı 0 görünüyordu.
 */
describe('#5 tamamlanan kutu yeniden başlamaz', () => {
  function akis(): { graph: AgentGraph; dis: AgentNode; ic: AgentNode; bekle: AgentNode; end: AgentNode } {
    edgeNo = 0
    const start = createNode('start', 0, 0)
    const bekle = createNode('wait', 300, 180)
    bekle.title = 'İç · bekle'
    bekle.ms = 1
    const ic = createNode('loop', 200, 120)
    ic.title = 'İç'
    ic.folder = '{{öğe}}'
    ic.members = [bekle.id]
    const dis = createNode('loop', 100, 60)
    dis.title = 'Dış'
    dis.items = [k1, k2, k3]
    dis.members = [ic.id]
    const end = createNode('end', 500, 0)
    // İç kutunun çıkışı YOK; dış kutunun çıkışı var.
    const graph: AgentGraph = { nodes: [start, dis, ic, bekle, end], edges: [edge(start, 'next', dis), edge(dis, 'done', end)] }
    return { graph, dis, ic, bekle, end }
  }

  it('dış kutu BİR kez çalışır ve Bitir’e ulaşılır (tamamlanan iş tekrarlanmaz)', async () => {
    const { graph, dis, bekle } = akis()
    const olaylar: string[] = []
    const loglar: string[] = []
    let hata = ''
    const ex: Executor = {
      log: (level, message) => loglar.push(`${level}: ${message}`),
      step: (id, status) => olaylar.push(`${id}:${status}`),
      shouldStop: () => false,
      click: async () => {},
      type: async () => {},
      key: async () => {},
      exists: async () => true,
    }
    try {
      await runGraph(graph, ex, opts)
    } catch (e) {
      hata = (e as Error).message
    }
    const disCalisma = olaylar.filter((x) => x === `${dis.id}:running`).length
    const bekleCalisma = olaylar.filter((x) => x === `${bekle.id}:running`).length
    const icRunning = olaylar.filter((x) => x.endsWith(':running')).length
    expect(hata, `koşu hata verdi: ${hata}`).toBe('')
    expect(disCalisma, `dış kutu ${disCalisma} kez çalıştı (1 olmalı; tamamlanan kutu yeniden başladı)`).toBe(1)
    // 3 klasör × 2 dosya = 6 tur; tamamlanan iş bir kez çalışır.
    expect(bekleCalisma, `iç bekleme ${bekleCalisma} kez çalıştı (6 olmalı)`).toBe(6)
    expect(icRunning, `toplam adım olayı beklenenden çok: ${icRunning}`).toBeLessThanOrEqual(20)
  })
})
