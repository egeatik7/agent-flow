import { describe, expect, it } from 'vitest'
import { assertModelKeysAllowed } from '../electron/key-guard'

/** The model's choice, however the engine wrote it: list engine sends a string, GUI engine an array. */
const allowed = (keys: string | string[]) => expect(() => assertModelKeysAllowed(keys)).not.toThrow()
const blocked = (keys: string | string[]) => expect(() => assertModelKeysAllowed(keys)).toThrow(/engellendi/)

describe('İnisiyatif: kapatma ve silme tuşları', () => {
  it('kapatma kombinasyonları hangi yazımla gelirse gelsin engellenir', () => {
    blocked('alt+f4')
    blocked(['alt', 'F4'])
    blocked('Alt + F4')
    blocked('%{F4}')
    blocked('ctrl+w')
    blocked(['ctrl', 'w'])
    blocked('ctrl+q')
    blocked('control+shift+w')
  })

  it('silme tuşları engellenir', () => {
    blocked('delete')
    blocked('Delete')
    blocked('del')
    blocked('shift+delete')
  })

  it('yük eşeği olarak kullanılan sıradan tuşlar serbest kalır', () => {
    allowed('ctrl+s')
    allowed('ctrl+a')
    allowed('enter')
    allowed('escape')
    allowed('esc')
    allowed('backspace')
    allowed('tab')
    allowed('win+d')
    allowed('win+tab')
    allowed('win+r')
    allowed('f4')
    allowed('shift+a')
    allowed(undefined)
    allowed([])
  })
})
