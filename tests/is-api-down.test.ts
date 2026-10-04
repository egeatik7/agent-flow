import { describe, expect, it } from 'vitest'
import { isApiDown } from '../electron/runner'

describe('isApiDown', () => {
  it('dosya adındaki veya yoldaki 401/402/429 API hatası sayılmaz', () => {
    expect(isApiDown('Klasor1: “Tıkla 1”: hedef yok: img_401.png')).toBe(false)
    expect(isApiDown('Yazı alana gitmedi: alanda “C:\\Resimler\\402.png” var.')).toBe(false)
    expect(isApiDown('“Her Öğe İçin 1”: klasör yok: C:\\Fotolar\\429')).toBe(false)
    expect(isApiDown('Tıklandı: Kaydet @1401,429')).toBe(false)
  })

  it('gerçek API mesajları hâlâ yakalanır', () => {
    expect(isApiDown('OpenRouter API anahtarı geçersiz (401).')).toBe(true)
    expect(isApiDown('OpenRouter bakiyesi yetersiz (402).')).toBe(true)
    expect(isApiDown('OpenRouter 429: Rate limit exceeded')).toBe(true)
    expect(isApiDown('OpenRouter 503: upstream error')).toBe(true)
    expect(isApiDown('RESOURCE_EXHAUSTED'.replace('_', ''))).toBe(true)
    expect(isApiDown('Too many requests, slow down')).toBe(true)
  })

  it('ilgisiz hata yakalanmaz', () => {
    expect(isApiDown('Yazı alana gitmedi: alanda “abc” var.')).toBe(false)
  })
})
