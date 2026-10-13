import { describe, expect, it } from 'vitest'
import { judgeScreen } from '../electron/confirm'

/**
 * D06 (yönerge) — boş normalize edilmiş yükleme iğnesi.
 *
 * Ölçülen kusur: `confirm.ts` içinde `norm(expected)` boş olabildiği (noktalama-only iğne, ör. "×" →
 * norm "") hâlde `norm(t).includes(norm(expected))` yazılıydı; `includes('')` HER ZAMAN doğru olduğu için
 * ilgisiz bir "işleniyor" yazısı adımı `loading` yapıyordu — yazılı kapsam kuralının (yalnız bu karede
 * YENİ çıkan yükleme yazısı ya da beklenen iğneyi İÇEREN üst-küme yazı) tam tersi.
 */
describe('D06: boş iğne ile yanlış loading kararı verilmez', () => {
  it('noktalama-only iğne ("×") ilgisiz bir yükleniyor yazısıyla loading SAYILMAZ', () => {
    // Yazı zaten ekranda (fresh DEĞİL): yalnız bozuk includes('') dalı loading yapabilirdi.
    const karar = judgeScreen(['işleniyor, lütfen bekleyin'], ['işleniyor, lütfen bekleyin'], '×')
    expect(karar.kind).not.toBe('loading') // ESKİ HATA: loading oluyordu
  })

  it('amaçlanan üst-küme kuralı korunur: beklenen "Tamam", ekranda "Tamamlanıyor" → loading', () => {
    expect(judgeScreen([], ['Tamamlanıyor'], 'Tamam').kind).toBe('loading')
  })

  it('bu karede YENİ çıkan yüklenme yazısı kuralı korunur (boş iğneden bağımsız)', () => {
    expect(judgeScreen([], ['Yükleniyor'], '').kind).toBe('loading')
  })

  it('ilgisiz yükleme yazısı ve eşleşmeyen iğne: loading değil', () => {
    expect(judgeScreen(['işleniyor'], ['işleniyor'], 'Kaydet').kind).not.toBe('loading')
  })
})
