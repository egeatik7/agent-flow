import { describe, expect, it, vi } from 'vitest'
// These fixtures describe Windows paths; keep the same rules on Linux CI.
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return { default: actual.win32 }
})
import { chooseLibraryDirectory, isProtectedPath } from '../electron/library-path'

/**
 * Ölçülen kusur (1.9.107): Denetimli klasör erişimi açıkken `mkdirSync("<Belgeler>\Nubbo\Kütüphane")`
 * süresiz bekledi (hata bile vermedi) ve uygulama "arayüz yükleniyor"da dondu. Bu dosya, klasör SEÇİM
 * kuralını ölçer: korumalı ve henüz var olmayan bir varsayılan ASLA oluşturulmaya çalışılmaz.
 */
const BELGELER = 'C:\\Users\\ASUS TUF\\Documents'
const EV = 'C:\\Users\\ASUS TUF'
const KORUMALI = [BELGELER, path('Desktop'), path('Pictures'), path('Videos'), path('Music'), path('Favorites')]
function path(name: string): string { return `C:\\Users\\ASUS TUF\\${name}` }

const sec = (configured: string, exists: (c: string) => boolean) =>
  chooseLibraryDirectory({ configured, documents: BELGELER, home: EV, exists, protectedRoots: KORUMALI })

describe('kütüphane klasörü seçimi (korumalı klasör oluşturmadan)', () => {
  it('korumalı kökteki kayıtlı yol geçici erişim yokluğunda DEĞİŞTİRİLMEZ (kullanıcı seçimi)', () => {
    const hedef = `${BELGELER}\\Nubbo\\Kütüphane`
    expect(sec(hedef, () => false)).toEqual({ directory: hedef, fallback: false })
  })

  it('kayıtlı ayar varsa tartışmasız onu kullanır', () => {
    const r = sec('D:\\NubboKutuphane', () => false)
    expect(r).toEqual({ directory: 'D:\\NubboKutuphane', fallback: false })
  })

  it('varsayılan Belgeler yolu zaten VARSA kullanılır (okumak güvenli, mkdir çağrılmaz)', () => {
    const r = sec('', (c) => c === `${BELGELER}\\Nubbo\\Kütüphane`)
    expect(r).toEqual({ directory: `${BELGELER}\\Nubbo\\Kütüphane`, fallback: false })
  })

  it('korumalı ve henüz YOK olan varsayılan yol yerine korumasız profil klasörüne düşer', () => {
    const r = sec('', () => false)
    expect(r).toEqual({ directory: `${EV}\\NubboKutuphane`, fallback: true })
  })

  it('Belgeler korumalı değilse (ör. başka bir sürücü) varsayılan yol kullanılır', () => {
    const r = chooseLibraryDirectory({
      configured: '', documents: 'D:\\Belgeler', home: EV, exists: () => false, protectedRoots: KORUMALI,
    })
    expect(r).toEqual({ directory: 'D:\\Belgeler\\Nubbo\\Kütüphane', fallback: false })
  })

  it('korumalı kök eşleşmesi sınır duyarlı ve büyük/küçük harf duyarsızdır', () => {
    expect(isProtectedPath('c:\\users\\asus tuf\\documents\\Nubbo', KORUMALI)).toBe(true)
    expect(isProtectedPath('C:\\Users\\ASUS TUF\\Documents', KORUMALI)).toBe(true)
    expect(isProtectedPath('C:\\Users\\ASUS TUF\\Documents2\\Nubbo', KORUMALI)).toBe(false)
    expect(isProtectedPath('C:\\Users\\ASUS TUF\\NubboKutuphane', KORUMALI)).toBe(false)
  })

  it('boşluklu ayar yok sayılır', () => {
    const r = sec('   ', () => false)
    expect(r.fallback).toBe(true)
  })

  it('kullanıcı seçimi kuralı: korumalı + yok = tehlikeli (klasör açma denenmez), diğerleri güvenli', () => {
    // main.ts `unsafeLibraryPath` tam olarak bu bileşimi kullanır.
    const tehlikeli = (aday: string, varMi: boolean) => isProtectedPath(aday, KORUMALI) && !varMi
    expect(tehlikeli(`${BELGELER}\\Nubbo\\Kütüphane`, false)).toBe(true)   // seçilirse uygulama kilitlenebilirdi
    expect(tehlikeli(`${BELGELER}\\Nubbo\\Kütüphane`, true)).toBe(false)   // zaten var: okumak güvenli
    expect(tehlikeli(`${EV}\\NubboKutuphane`, false)).toBe(false)         // korumasız: klasör açılabilir
  })
})
