import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseTars } from '../electron/openrouter'

/**
 * FARE OYNATMA yetkisi.
 *
 * Kullanıcının isteği: İnisiyatif'teki model bazen tıklayacağı yeri net seçemiyor, yanlış yere
 * tıklayıp "correction" ile arıyordu. Artık önce fareyi oynatabilir (tıklamadan), emin olunca
 * bulunduğu yerden tıklayabilir. Ayrıca tıkla node'unda "Fareyi Oynat" modu var.
 *
 * Güvence: konum bilinmiyorsa uydurulmaz; "oradan tıkla" fare neredeyse ORADAN tıklar.
 */
const kok = path.join(__dirname, '..')

describe('fare oynatma (move) ve oradan tıklama (clickCurrent)', () => {
  it('move(start_box=…) → move eylemi (tıklama DEĞİL)', () => {
    const a = parseTars("move(start_box='<|box_start|>(120,340)<|box_end|>')", 1000, 1000, true)
    expect(a.kind, 'fare oynatma tıklamaya dönüşmüş').toBe('move')
  })

  it('mouse_move / hover da move sayılır', () => {
    for (const c of ["mouse_move(start_box='<|box_start|>(10,20)<|box_end|>')", "hover(start_box='<|box_start|>(10,20)<|box_end|>')"]) {
      expect(parseTars(c, 1000, 1000, true).kind).toBe('move')
    }
  })

  it('click_current() → fare konumundan tıklama', () => {
    expect(parseTars('click_current()', 1000, 1000, true).kind).toBe('clickCurrent')
    expect(parseTars('click_here()', 1000, 1000, true).kind).toBe('clickCurrent')
  })

  it('koordinatsız click() artık “oradan tıkla” (eskiden boş bekleme sayılıyordu)', () => {
    const a = parseTars('click()', 1000, 1000, true)
    expect(a.kind, 'koordinatsız tıklama hâlâ wait').toBe('clickCurrent')
  })

  it('koordinatlı click() eskisi gibi tıklama (davranış korunuyor)', () => {
    const a = parseTars("click(start_box='<|box_start|>(50,60)<|box_end|>')", 1000, 1000, true)
    expect(a.kind).toBe('click')
    expect(a.x !== undefined && a.y !== undefined).toBe(true)
  })

  it('tıkla node’unun mod kutusunda “Fareyi Oynat” var (tek/çift/sağ tıkın yanında)', () => {
    const ui = fs.readFileSync(path.join(kok, 'src/components/SidePanel.tsx'), 'utf8')
    expect(ui, "mod kutusunda 'Fareyi Oynat' yok").toContain("label: 'Fareyi Oynat'")
    expect(ui, "'move' modu kayıtlı değil").toMatch(/key:\s*'move'/)
    // eski üç mod korunmuş olmalı
    for (const eski of ["label: 'Tek tık'", "label: 'Çift tık'", "label: 'Sağ tık'"]) expect(ui, `${eski} kaybolmuş`).toContain(eski)
  })

  it('kayıtlı yol adımları move ve clickCurrent taşıyabilir (oynatma hover’ı kaybetmez)', () => {
    const t = fs.readFileSync(path.join(kok, 'electron/graph-types.ts'), 'utf8')
    const satir = t.split('\n').find((x) => x.includes("action: 'click'"))
    expect(satir, 'PathStep.action satırı bulunamadı').toBeTruthy()
    expect(satir!).toContain("'move'")
    expect(satir!).toContain("'clickCurrent'")
  })

  it('ClickMode “move” içerir (tıkla node’unun ayarı genişledi, eskiler duruyor)', () => {
    const t = fs.readFileSync(path.join(kok, 'electron/graph-types.ts'), 'utf8')
    const satir = t.split('\n').find((x) => x.includes('export type ClickMode'))
    expect(satir).toContain("'left'")
    expect(satir).toContain("'double'")
    expect(satir).toContain("'right'")
    expect(satir, "'move' modu yok").toContain("'move'")
  })

  it('worker yalnız imleci taşır: moveAt tıklama göndermiyor', () => {
    const w = fs.readFileSync(path.join(kok, 'a11y/worker.ps1'), 'utf8')
    const i = w.indexOf("'moveAt' {")
    expect(i, 'moveAt aksiyonu yok').toBeGreaterThan(-1)
    // Yalnız moveAt aksiyonunun gövdesi: bir SONRAKİ aksiyona kadar (clickAt'i dahil etme!).
    const sonraki = ["'clickAt' {", "'locate' {", "'crop' {"].map((x) => w.indexOf(x, i)).filter((x) => x > i).sort((a, b) => a - b)[0]
    const blok = w.slice(i, sonraki ?? i + 900)
    expect(blok, 'moveAt tıklama çağırıyor (yalnız taşımalı)').not.toMatch(/Invoke-MouseAt|mouse_event/)
    expect(blok, 'moveAt imleci taşımıyor').toContain('SetCursorPos')
  })
})
