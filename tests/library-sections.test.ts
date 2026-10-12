import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CanvasBook, CanvasLibrary } from '../electron/graph-types'
import { changeLibrary } from '../electron/library-tree'
import { LibraryStorage, isLibraryConflict } from '../electron/library-storage'
import { initializeLibraryDatabase } from '../electron/library-database'

const bos = (): CanvasLibrary => ({ folders: [], canvases: [], automations: [] })
const kitap = (): CanvasBook => ({ tabs: [], activeId: '', library: bos() })

beforeAll(() => initializeLibraryDatabase())

describe('kütüphane bölümleri (Tuval / Otomasyon)', () => {
  it('yeni klasör bölümünü taşır; aynı üstte aynı ad reddedilir, farklı üstte serbesttir', () => {
    let b = changeLibrary(kitap(), { action: 'newFolder', name: 'Üretim', section: 'automation' })
    expect(b.library!.folders?.[0].section).toBe('automation')
    // Ayni ad YALNIZ ayni bolumde yasak: iki bolum bagimsiz agactir.
    expect(() => changeLibrary(b, { action: 'newFolder', name: 'üretim', section: 'canvas' })).not.toThrow()
    expect(() => changeLibrary(b, { action: 'newFolder', name: 'üretim', section: 'automation' })).toThrow(/aynı adlı/)
    b = changeLibrary(b, { action: 'newFolder', name: 'Üretim', parentId: b.library!.folders![0].id, section: 'automation' })
    expect(b.library!.folders).toHaveLength(2)
  })

  it('başka bölümün klasörüne taşınan klasör o bölüme geçer (karışık dal kalmaz)', () => {
    let b = changeLibrary(kitap(), { action: 'newFolder', name: 'A', section: 'canvas' })
    b = changeLibrary(b, { action: 'newFolder', name: 'B', section: 'automation' })
    const [a, bb] = b.library!.folders!
    b = changeLibrary(b, { action: 'move', refs: [{ kind: 'folder', id: a.id }], parentId: bb.id })
    expect(b.library!.folders!.find(f => f.id === a.id)?.section).toBe('automation')
  })

  it('silinen klasörde bekleyen otomasyon taslağının klasör bağı temizlenir (görünmez/kaydedilemez kalmasın)', () => {
    let b: CanvasBook = { ...kitap(), automationDraft: { key: 'yeni', name: 'Taslak', folderId: 'artik-yok', entries: [] } }
    b = changeLibrary(b, { action: 'newFolder', name: 'X' })
    expect(b.automationDraft?.folderId).toBeUndefined()
  })

  it('bölümü olmayan eski klasör iki görünümde de görünür (hiçbir klasör kaybolmaz)', () => {
    const b = changeLibrary(kitap(), { action: 'newFolder', name: 'Eski' })
    expect(b.library!.folders?.[0].section).toBeUndefined()
  })
})

describe('kütüphane kayıt çakışması ve toparlanma', () => {
  it('dış yazımdan sonra kayıt tipli çakışma hatası verir; reload sonrası yeniden yazabilir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-cakisma-'))
    try {
      const birinci = new LibraryStorage(dir)
      birinci.load(bos())
      // Meşru dış yazım: ikinci bir Nubbo aynı klasöre yazdı.
      const ikinci = new LibraryStorage(dir)
      ikinci.load(bos())
      ikinci.save({ folders: [{ id: 'f1', name: 'Dış' }], canvases: [], automations: [] })

      let hata: unknown
      try { birinci.save({ ...bos(), canvases: [] }) } catch (e) { hata = e }
      expect(isLibraryConflict(hata)).toBe(true)
      expect(birinci.stale()).toBe(true)

      const taze = birinci.reload()
      expect(taze.folders?.[0].name).toBe('Dış')
      expect(birinci.stale()).toBe(false)
      expect(() => birinci.save(taze)).not.toThrow()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

it('moving a folder cannot create a second same-name sibling', () => {
 const initial: CanvasBook = { tabs: [], activeId: '', library: { folders: [{ id: 'parent', name: 'P', section: 'canvas' }, { id: 'one', name: 'Same', section: 'canvas' }, { id: 'two', name: 'same', parentId: 'parent', section: 'canvas' }], canvases: [], automations: [] } }
 const before = structuredClone(initial)
 expect(() => changeLibrary(initial, { action: 'move', refs: [{ kind: 'folder', id: 'one' }], parentId: 'parent' })).toThrow('aynı adlı')
 expect(initial).toEqual(before)
})
it('cross-section moves preserve visible folder content instead of retagging it into the wrong section', () => {
 const initial: CanvasBook = { tabs: [], activeId: '', library: { folders: [{ id: 'source', name: 'S', section: 'canvas' }, { id: 'target', name: 'T', section: 'automation' }], canvases: [{ id: 'canvas', name: 'C', folderId: 'source', graph: { nodes: [], edges: [] }, updatedAt: 0 }], automations: [] } }
 expect(() => changeLibrary(initial, { action: 'move', refs: [{ kind: 'folder', id: 'source' }], parentId: 'target' })).toThrow('bölümle uyuşmuyor')
 expect(() => changeLibrary(initial, { action: 'move', refs: [{ kind: 'canvas', id: 'canvas' }], parentId: 'target' })).toThrow('bölümle uyuşmuyor')
})
