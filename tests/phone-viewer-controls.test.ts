// @vitest-environment jsdom
import { createElement } from 'react'
import { act,create,type ReactTestRenderer,type ReactTestInstance } from 'react-test-renderer'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { ViewerState } from '../electron/viewer-state'
import { applyViewerMessage } from '../src/viewer/model'
import type { ViewerSnapshot } from '../electron/viewer-types'
const h=vi.hoisted(()=>({state:null as unknown,connected:true,error:''}))
vi.mock('../src/viewer/useViewer',()=>({useViewer:()=>h}))
vi.mock('../src/components/NodeCanvas',()=>({default:()=>null}))
vi.mock('../src/components/NodeNavigator',()=>({default:()=>null}))
vi.mock('../src/components/NubboMascot',()=>({default:()=>null}))
vi.mock('../src/components/RecoveryNote',()=>({default:()=>null}))
import ViewerApp from '../src/viewer/ViewerApp'
import NodeCanvas from '../src/components/NodeCanvas'
import ViewerHudScreen from '../src/viewer/ViewerHudScreen'
let mounted:ReactTestRenderer|undefined
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join('')
const button=(label:string)=>mounted!.root.findAllByType('button').find(b=>text(b)===label)!
const fixture=()=>{
 const leaf={...createNode('click',100,50),id:'leaf'},inner={nodes:[leaf],edges:[]},pkg={...createNode('package',0,0),id:'pkg',inner},second={...createNode('wait',500,0),id:'second'}
 const state=new ViewerState('test');state.begin('run-1','canvas',{nodes:[pkg,second],edges:[]});state.event('agent:step',{id:'leaf',status:'running'});return state
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1000);Object.defineProperty(document,'hidden',{configurable:true,value:false});h.connected=true;h.error='';h.state=fixture().snapshot()})
afterEach(()=>{if(mounted)act(()=>mounted!.unmount());mounted=undefined;vi.useRealTimers()})
const mount=()=>act(()=>{mounted=create(createElement(ViewerApp))})
const redraw=(state:ViewerSnapshot)=>act(()=>{h.state=state;mounted!.update(createElement(ViewerApp))})
describe('phone active node lock',()=>{
 it('follows nested packages, new active nodes and a new canvas run immediately',()=>{
  const state=fixture();h.state=state.snapshot();mount();act(()=>button('Aktif node’a kilitle').props.onClick())
  let canvas=mounted!.root.findByType(NodeCanvas);expect(canvas.props.graph.nodes.some((n:{id:string})=>n.id==='leaf')).toBe(true);expect(canvas.props.focus.nodeId).toBe('leaf');expect(canvas.props.canvasKey).toBe('@run:pkg')
  const firstFocus=canvas.props.focus.at
  state.event('agent:step',{id:'second',status:'running'});redraw(state.snapshot());canvas=mounted!.root.findByType(NodeCanvas);expect(canvas.props.canvasKey).toBe('@run:');expect(canvas.props.focus.nodeId).toBe('second');expect(canvas.props.focus.at).toBeGreaterThan(firstFocus)
  const next={...createNode('type',0,0),id:'next'};state.begin('run-2','new-canvas',{nodes:[next],edges:[]});state.event('agent:step',{id:'next',status:'running'});redraw(state.snapshot());expect(mounted!.root.findByType(NodeCanvas).props.focus.nodeId).toBe('next')
 })
 it('keeps recentering during one long node, pauses when hidden and stops after unlocking',()=>{
  mount();act(()=>button('Aktif node’a kilitle').props.onClick());const first=mounted!.root.findByType(NodeCanvas).props.focus.at
  act(()=>{vi.advanceTimersByTime(500)});expect(mounted!.root.findByType(NodeCanvas).props.focus.at).toBeGreaterThan(first)
  Object.defineProperty(document,'hidden',{configurable:true,value:true});const paused=mounted!.root.findByType(NodeCanvas).props.focus.at;act(()=>{vi.advanceTimersByTime(500)});expect(mounted!.root.findByType(NodeCanvas).props.focus.at).toBe(paused)
  Object.defineProperty(document,'hidden',{configurable:true,value:false});act(()=>{window.dispatchEvent(new Event('resize'))});expect(mounted!.root.findByType(NodeCanvas).props.focus.at).toBeGreaterThan(paused)
  act(()=>button('Aktif node’a kilitle').props.onClick());const unlocked=mounted!.root.findByType(NodeCanvas).props.focus.at;act(()=>{vi.advanceTimersByTime(1000)});expect(mounted!.root.findByType(NodeCanvas).props.focus.at).toBe(unlocked);expect(mounted!.root.findByType(NodeCanvas).props.canvasKey).toBe('@run:pkg')
 })
 it('can be enabled before a run starts and locks to the first live node',()=>{
  const state=new ViewerState('test');h.state=state.snapshot();mount();act(()=>button('Aktif node’a kilitle').props.onClick());expect(button('Aktif node’a kilitle').props['aria-pressed']).toBe(true)
  const node={...createNode('click',0,0),id:'live'};state.begin('run','canvas',{nodes:[node],edges:[]});state.event('agent:step',{id:'live',status:'running'});redraw(state.snapshot());expect(mounted!.root.findByType(NodeCanvas).props.focus.nodeId).toBe('live')
 })
})
describe('live full-screen information card',()=>{
 it('shows exact PC status, countdown, method and loop after opening and live updates',()=>{
  const state=fixture();state.event('hud:status',{level:'warn',text:'PC kartındaki metin'});state.event('hud:loop',{text:'Modeller · 3/12'});state.event('hud:method',{text:'Windows OCR'});state.event('hud:countdown',{text:'kalan 3,2 / 5,0 sn'});h.state=state.snapshot();mount();act(()=>button('Bilgi kartı · Tam ekran').props.onClick());expect(mounted!.root.findByType(ViewerHudScreen)).toBeDefined();const shown=text(mounted!.root.findByProps({role:'dialog'}));for(const value of ['PC kartındaki metin','Modeller · 3/12','Windows OCR','kalan 3,2 / 5,0 sn'])expect(shown).toContain(value)
  state.event('hud:countdown',{text:'kalan 1,0 / 5,0 sn'});redraw(state.snapshot());expect(text(mounted!.root.findByProps({role:'dialog'}))).toContain('kalan 1,0 / 5,0 sn');act(()=>button('Kapat').props.onClick());expect(mounted!.root.findAllByType(ViewerHudScreen)).toHaveLength(0)
 })
 it('marks stale values on disconnect and Escape returns to the canvas',()=>{
  mount();act(()=>button('Bilgi kartı · Tam ekran').props.onClick());h.connected=false;h.error='PC bağlantısı kesildi';redraw(h.state as ViewerSnapshot);expect(text(mounted!.root.findByProps({role:'dialog'}))).toContain('son alınan bilgi');expect(text(mounted!.root.findByProps({role:'dialog'}))).toContain('PC bağlantısı kesildi');act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))});expect(mounted!.root.findAllByType(ViewerHudScreen)).toHaveLength(0)
 })
 it('countdown refreshes keep the execution graph reference instead of cloning it five times a second',()=>{
  const state=fixture(),current=state.snapshot();let message!:import('../electron/viewer-types').ViewerMessage;state.subscribe(m=>{message=m});state.event('hud:countdown',{text:'kalan 2,0 sn'});const next=applyViewerMessage(current,message);expect(next.run).toBe(current.run);expect(next.hud?.countdown).toBe('kalan 2,0 sn')
 })
 it('server and client preserve HUD events even without a run and reconnect to the same card',()=>{
  const state=new ViewerState('test');let model=state.snapshot();state.subscribe(m=>{model=applyViewerMessage(model,structuredClone(m))})
  for(const [channel,payload] of [['hud:status',{level:'success',text:'Bitti'}],['hud:countdown',{text:'kalan 0,0 sn'}],['hud:loop',{text:'20/20'}],['hud:method',{text:'OCR'}],['recovery:status',{active:true,nodeTitle:'Tıkla',message:'Onarılıyor'}],['recovery:status',{active:false,nodeTitle:'Tıkla',message:'Onarıldı'}],['hud:countdown',{text:''}],['hud:loop',{text:''}],['hud:method',{text:''}]] as const){state.event(channel,payload);expect(model.hud).toEqual(state.snapshot().hud)}
  expect(model.hud?.countdown).toBe('');expect(model.hud?.recovering).toBe(false);expect(model.hud?.text).toBe('Tıkla: Onarıldı');expect(applyViewerMessage(null,{type:'snapshot',state:state.snapshot()}).hud).toEqual(model.hud)
 })
})
