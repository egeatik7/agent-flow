import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { collectLoopPaths, fullItemPath, isAbsolutePath, missingLoopPaths } from '../src/lib/item-paths'

const loop = (items: string[], folder?: string, patch: Partial<ReturnType<typeof createNode>> = {}) => ({
  ...createNode('loop', 0, 0), id: 'l1', title: 'Döngü', items, ...(folder === undefined ? {} : { folder }), ...patch,
} as never)
const canvas = (nodes: unknown[]): { name: string; graph: AgentGraph } => ({ name: 'Tuval', graph: { nodes: nodes as AgentGraph['nodes'], edges: [] } })

describe('koşu öncesi döngü yolu denetimi', () => {
  it('mutlak yolu aynen alır, göreli öğeyi klasörle birleştirir, şablonlu klasörde çözmez', () => {
    expect(fullItemPath('C:\\a\\b.glb')).toBe('C:\\a\\b.glb')
    expect(fullItemPath('\\\\sunucu\\pay\\x.glb')).toBe('\\\\sunucu\\pay\\x.glb')
    expect(fullItemPath('b.glb', 'C:\\a\\')).toBe('C:\\a\\b.glb')
    expect(fullItemPath('b.glb', 'C:\\a\\{{öğe}}')).toBe('')
    expect(fullItemPath('b.glb', '')).toBe('')
    expect(fullItemPath('kedi', 'C:\\a')).toBe('C:\\a\\kedi')
    expect(isAbsolutePath('kedi')).toBe(false)
    expect(isAbsolutePath('D:/x/y.png')).toBe(true)
  })

  it('yalnız mutlak görünen yolları toplar; düz metin öğe ve şablonlu klasör rapora girmez', () => {
    const paths = collectLoopPaths([canvas([
      loop(['C:\\var\\a.glb', 'sadece-metin'], undefined),
      loop(['a.glb'], 'C:\\var'),
      loop(['a.glb'], 'C:\\var\\{{öğe}}'),
    ])])
    const list = paths.map((p) => p.path)
    expect(list).toContain('C:\\var\\a.glb')
    expect(list).toContain('C:\\var')          // döngünün kendi klasör alanı
    expect(list).not.toContain('sadece-metin') // klasörü olmayan düz metin öğe: yol değil, atlanır
    expect(list.some((p) => p.includes('{{öğe}}'))).toBe(false)
    expect(paths.filter((p) => p.kind === 'klasör').length).toBe(1)
  })

  it('paket içindeki döngüyü de gezer ve aynı yolu iki kez raporlamaz', () => {
    const inner = { ...createNode('package', 0, 0), id: 'p1', title: 'Paket', inner: { nodes: [loop(['C:\\var\\a.glb'])], edges: [] } }
    const paths = collectLoopPaths([canvas([inner, loop(['C:\\var\\a.glb'])])])
    expect(paths.length).toBe(1)
  })

  it('diskte olmayanları sebebiyle raporlar', () => {
    const paths = collectLoopPaths([canvas([loop(['C:\\var\\yok.glb']), loop(['a.glb'], 'C:\\var\\yok-klasor')])])
    const rapor = missingLoopPaths(paths, new Set(['C:\\var\\yok.glb']))
    expect(rapor.length).toBe(1)
    expect(rapor[0].reason).toBe('dosya bulunamadı')
    const klasor = missingLoopPaths(collectLoopPaths([canvas([loop(['a.glb'], 'C:\\var\\yok-klasor')])]), new Set(['C:\\var\\yok-klasor']))
    expect(klasor[0].reason).toBe('klasör bulunamadı')
  })
})
