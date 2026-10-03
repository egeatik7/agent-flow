import { describe, expect, it } from 'vitest'
import { itemVars, loopKeys, renderTemplate, createNode } from '../electron/graph-types'

describe('test altyapısı', () => {
  it('projenin kendi kodunu içe aktarıp çalıştırabiliyor', () => {
    const vars = itemVars('C:\\Resimler\\kedi.png', 0, 3)
    expect(renderTemplate('{{öğe.isim}} / {{sıra}} / {{toplam}}', vars)).toBe('kedi / 1 / 3')
  })

  it('liste yoksa döngü sayıya göre tur üretir', () => {
    const loop = createNode('loop', 0, 0)
    loop.count = 3
    expect(loopKeys(loop)).toEqual(['#1', '#2', '#3'])
  })
})
