// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewerDevice } from '../src/viewer/device'
import { ViewerState } from '../electron/viewer-state'
const h=vi.hoisted(()=>({state:null as unknown,connected:true,error:''}))
vi.mock('../src/viewer/useViewer',()=>({useViewer:()=>h}))
vi.mock('../src/components/NodeCanvas',()=>({default:()=>null}))
vi.mock('../src/components/NodeNavigator',()=>({default:()=>null}))
vi.mock('../src/components/NubboMascot',()=>({default:()=>null}))
vi.mock('../src/components/RecoveryNote',()=>({default:()=>null}))
import ViewerApp from '../src/viewer/ViewerApp'
import ViewerHudScreen from '../src/viewer/ViewerHudScreen'
import NodeCanvas from '../src/components/NodeCanvas'
let mounted:ReactTestRenderer|undefined
const original=Object.getOwnPropertyDescriptor(navigator,'userAgent')
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join('')
function mount(agent:string){Object.defineProperty(navigator,'userAgent',{configurable:true,value:agent});const state=new ViewerState('test');state.event('hud:status',{level:'info',text:'PC bilgi kartı'});state.event('hud:countdown',{text:'kalan 3,0 sn'});h.state=state.snapshot();h.connected=true;h.error='';act(()=>{mounted=create(createElement(ViewerApp))});return state}
afterEach(()=>{if(mounted)act(()=>mounted!.unmount());mounted=undefined;if(original)Object.defineProperty(navigator,'userAgent',original);else delete (navigator as unknown as {userAgent?:string}).userAgent})
describe('device class selection',()=>{
 it('native phone/tablet marker overrides desktop user-agent and viewport/orientation',()=>{
  expect(viewerDevice('Chrome Desktop NubboDevice/phone',1200,800)).toBe('phone')
  expect(viewerDevice('Android Mobile NubboDevice/tablet',400,900)).toBe('tablet')
  expect(viewerDevice('NubboDevice/TABLET',900,400)).toBe('tablet')
 })
 it('old Android clients keep phone mode in portrait and landscape',()=>{
  expect(viewerDevice('Android WebView',390,844)).toBe('phone');expect(viewerDevice('Android WebView',844,390)).toBe('phone');expect(viewerDevice('Android WebView',800,1280)).toBe('tablet')
 })
 it('does not mistake a narrow desktop window for a phone and recognizes iPad desktop mode',()=>{
  expect(viewerDevice('Windows Chrome',350,650)).toBe('desktop');expect(viewerDevice('Macintosh Safari',800,1200,5)).toBe('tablet');expect(viewerDevice('iPhone',390,844)).toBe('phone')
 })
})
describe('phone is only the live information card',()=>{
 it('opens directly to the card, without canvas, tabs, library, log or close control',()=>{
  mount('Android NubboDevice/phone');expect(mounted!.root.findByType(ViewerHudScreen).props.phoneOnly).toBe(true);expect(mounted!.root.findAllByType(NodeCanvas)).toHaveLength(0);expect(mounted!.root.findAllByType('button')).toHaveLength(0)
  const shown=text(mounted!.root);expect(shown).toContain('PC bilgi kartı');expect(shown).toContain('kalan 3,0 sn');for(const value of ['Tuvaller','Arşiv','Günlük','Aktif node’a kilitle','Kapat'])expect(shown).not.toContain(value)
 })
 it('Escape and orientation changes cannot reveal the tablet UI on a native phone',()=>{
  mount('Android NubboDevice/phone');act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));window.dispatchEvent(new Event('resize'))});expect(mounted!.root.findAllByType(ViewerHudScreen)).toHaveLength(1);expect(mounted!.root.findAllByType('button')).toHaveLength(0)
 })
 it('continues showing live and disconnected card states without rendering other views',()=>{
  const state=mount('Android NubboDevice/phone');state.event('hud:status',{level:'success',text:'İş tamamlandı'});h.state=state.snapshot();h.connected=false;h.error='PC’ye ulaşılamıyor';act(()=>mounted!.update(createElement(ViewerApp)));expect(text(mounted!.root)).toContain('İş tamamlandı');expect(text(mounted!.root)).toContain('son alınan bilgi');expect(mounted!.root.findAllByType(NodeCanvas)).toHaveLength(0)
 })
 it('keeps the normal viewer and optional full-screen card on tablets',()=>{
  mount('Android Mobile NubboDevice/tablet');expect(mounted!.root.findAllByType(ViewerHudScreen)).toHaveLength(0);expect(text(mounted!.root)).toContain('Aktif node’a kilitle');expect(text(mounted!.root)).toContain('Tuvaller')
 })
})
