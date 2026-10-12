import { describe, expect, it } from 'vitest'
import { bestWordMatch, wordScore } from '../electron/word-targets'

/**
 * Kullanıcının isteği (1.9.111): "en çok benzeyen kelimeyi seçsin, 'blkonr' yazsam bile blender'ı seçsin
 * hunyuan yerine" + "talimat tek kelime olmuyor, cümle oluyor" + "kelimeler arası uzaklığa bakmasın".
 * Bu dosya kararı ölçer: mesafe/uzaklık hesabı YOK; birebir, önek, tam sözcük geçişi ve ilk-harf/uzunluk
 * yakınlığı kullanılır; talimat cümlesinin TÜM sözcükleri denenir.
 */
describe('talimata en uygun kelimeyi program seçer', () => {
  it('sentence-length instruction picks the matching word of the line', () => {
    const satir = ['04_Hunyuanm', 'Blender', '5.2']
    expect(bestWordMatch(satir, 'Masaüstündeki Blender 5.2')?.word).toBe('Blender')
    // "5.2" de eşleşir ama karar tek bir kazanan ister: en iyi puan "Blender".
    expect(bestWordMatch(satir, 'masaüstündeki 5.2 klasörüne çift tıkla')?.word).toBe('5.2')
  })

  it('typo tolerance without any distance metric: blkonr -> Blender (not Hunyuan)', () => {
    const satir = ['04_Hunyuanm', 'Blender', '5.2']
    expect(bestWordMatch(satir, 'masaüstündeki blkonr klasörü')?.word).toBe('Blender')
    expect(wordScore('Blender', 'blkonr')).toBeGreaterThan(0.6)
    expect(wordScore('04_Hunyuanm', 'blkonr')).toBe(0)
  })

  it('when the user really means Hunyuan, Hunyuan wins', () => {
    const satir = ['04_Hunyuanm', 'Blender', '5.2']
    expect(bestWordMatch(satir, 'Hunyuan klasörünü aç')?.word).toBe('04_Hunyuanm')
  })

  it('exact and inclusion matches are decisive; unrelated text yields null (model keeps its choice)', () => {
    expect(bestWordMatch(['Kaydet', 'İptal'], 'Kaydet düğmesine tıkla')?.word).toBe('Kaydet')
    expect(bestWordMatch(['C:\\Users\\ASUS TUF\\Documents', 'Kaydet'], 'adres giriş kutusuna tıkla')).toBeNull()
    expect(bestWordMatch(['Kaydet', 'İptal'], '')).toBeNull()
    expect(bestWordMatch(['Kaydet'], 'Kaydet')).toBeNull() // tek kelimelik satırda seçim yok
  })

  it('short fragments never win on their own', () => {
    expect(wordScore('5.', 'blender')).toBe(0)
    expect(wordScore('C:', 'blender')).toBe(0)
    expect(bestWordMatch(['5.', 'Blender'], 'blender dosyası')?.word).toBe('Blender')
  })
})
