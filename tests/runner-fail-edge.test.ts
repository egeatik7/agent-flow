import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `fe${++edgeNo}`, from: from.id, fromPort, to: to.id })
const opts = { maxSteps: 100, stepDelayMs: 0 }

/**
 * #4 — Bağlanmamış `fail` çıkışı.
 *
 * Ölçülen kusur: node önce `done` olarak bildiriliyor, ardından bağlı olmayan `fail` çıkışı yüzünden
 * hata fırlatılıyor. Sonuç: araç katmanı hiç `error` olayı görmediği için debug koşusu DURMUYOR ve
 * donmuş hata kaydı oluşmuyor; döngü sıradaki öğeye geçiyor. Ajan müdahale ederken sorun anının
 * bağlamı (hangi node, hangi öğe) kayboluyor.
 */
describe('#4 bağlanmamış fail çıkışı', () => {
  it('başarısız node HATA olarak bildirilir (debug donmasının dayanağı) ve "done" denmez', async () => {
    const start = createNode('start', 0, 0)
    const ai = createNode('ai', 100, 0)
    ai.title = 'Karar'
    ai.prompt = 'bir seçenek seç'
    const after = createNode('click', 200, 0)
    after.prompt = 'sonraki'
    const loop = createNode('loop', 150, 50)
    loop.title = 'Dosyalar'
    loop.items = ['bir', 'iki']
    loop.members = [ai.id]
    // ai'nin "fail" çıkışı hiçbir yere bağlı değil; yalnız "next" bağlı.
    const graph: AgentGraph = { nodes: [start, loop, ai, after], edges: [edge(start, 'next', loop), edge(ai, 'next', after)] }

    const olaylar: string[] = []
    const ex: Executor = {
      log: () => {},
      step: (id, status) => olaylar.push(`${id}:${status}`),
      shouldStop: () => false,
      click: async () => {},
      type: async () => {},
      key: async () => {},
      exists: async () => true,
      initiative: async () => false,
    }

    let hata: string | null = null
    try {
      await runGraph(graph, ex, opts)
    } catch (e) {
      hata = (e as Error).message
    }

    const kendi = olaylar.filter((x) => x.startsWith(`${ai.id}:`))
    // Hatanın fırlatıldığı görülmeli (davranış korunuyor) — mesaj "bağlı değil" diyor.
    expect(hata ?? '', `hata beklenirdi; olaylar: ${JSON.stringify(kendi)}`).toMatch(/bağlı değil/)
    // KUSUR: hata olayı hiç gönderilmiyor, "done" gönderiliyor.
    expect(
      kendi.filter((x) => x.endsWith(':error')).length,
      `başarısız node HATA olarak bildirilmedi (debug donması oluşamaz): ${JSON.stringify(kendi)}`
    ).toBeGreaterThan(0)
  })
})
