import { describe,expect,it } from 'vitest'
import { ViewerState } from '../electron/viewer-state'
import { createNode } from '../electron/graph-types'
import { applyViewerMessage } from '../src/viewer/model'
import type { ViewerMessage } from '../electron/viewer-types'
import { tailnetName } from '../electron/viewer-tailscale'
describe('tablet snapshot consistency',()=>{
 it('requests a fresh snapshot after any missed message or PC restart',()=>{
  const state=new ViewerState('1.9.89'),current=state.snapshot()
  expect(()=>applyViewerMessage(current,{type:'heartbeat',session:current.session,seq:current.seq+1,at:1})).toThrow('Eksik')
  expect(()=>applyViewerMessage(current,{type:'heartbeat',session:'new-pc-session',seq:0,at:1})).toThrow('oturum')
  expect(()=>applyViewerMessage(current,{type:'event',session:current.session,seq:2,at:1,channel:'agent:log',payload:{}})).toThrow('Eksik')
 })
 it('keeps the failed leaf when its enclosing package and loop also report errors',()=>{
  const leaf={...createNode('type',0,0),id:'leaf'},pkg={...createNode('package',0,0),id:'pkg',inner:{nodes:[leaf],edges:[]}},loop={...createNode('loop',0,0),id:'loop',members:['pkg']}
  const state=new ViewerState('1.9.89');state.begin('run','canvas',{nodes:[loop,pkg],edges:[]});let model=state.snapshot()
  state.subscribe((m:ViewerMessage)=>{model=applyViewerMessage(model,structuredClone(m))})
  for(const id of ['leaf','pkg','loop'])state.event('agent:step',{id,status:'error'})
  expect(state.state.run!.nodeId).toBe('leaf');expect(model.run).toEqual(state.snapshot().run)
 })
 it('uses the private MagicDNS name and refuses disconnected/foreign status',()=>{
  expect(tailnetName(JSON.stringify({BackendState:'Running',Self:{DNSName:'pc.tail123.ts.net.'}}))).toBe('pc.tail123.ts.net')
  for(const input of [{BackendState:'Stopped'},{BackendState:'Running',Self:{DNSName:'public.example.com'}}])expect(()=>tailnetName(JSON.stringify(input))).toThrow()
 })
})
