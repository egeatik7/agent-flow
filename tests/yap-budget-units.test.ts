import { describe, expect, it } from 'vitest'
import { yapBudgetCheck } from '../electron/yap-context'

// Ölçülen kusur (1.9.159): kapı BAYT tahminini TOKEN penceresiyle kıyaslıyordu; 8192'lik yerel
// pencerede 6.875 baytlık istek 8.923 > 8192 diye hiç gönderilmiyordu.
describe('Yap giriş bütçesi: bayt ≠ token', () => {
  it('8192 pencerede 6875 baytlık istek geçer (eski hata: bloklanıyordu)', () => {
    expect(yapBudgetCheck(6875, 8192).ok).toBe(true)
  })

  it('4096 pencerede de sığan istek geçer (eski /2+2048 fazla engelliyordu)', () => {
    expect(yapBudgetCheck(6875, 4096).ok).toBe(true)
  })

  it('görüntülü tahmin 8192 pencereye sığar', () => {
    const result = yapBudgetCheck(10742, 8192)
    expect(result.tokens).toBe(3581)
    expect(result.ok).toBe(true)
  })

  it('çok büyük istek gerçekten reddedilir', () => {
    expect(yapBudgetCheck(40000, 8192).ok).toBe(false)
  })

  it('boş istek her pencerede geçer; negatif tahmin 0 sayılır', () => {
    expect(yapBudgetCheck(0, 2048).ok).toBe(true)
    expect(yapBudgetCheck(-5, 2048).tokens).toBe(0)
  })
})
