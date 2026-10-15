import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { repeatMethodCycle } from '../electron/method-cycle'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import { createNode, type AgentGraph } from '../electron/graph-types'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const base = (): Executor => ({ shouldStop: () => false, log: () => {}, step: () => {}, click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => false })
const graph = (kind: 'click'|'type'|'key'|'condition'|'ai'): AgentGraph => {
 const start = createNode('start',0,0), loop = createNode('loop',0,0), previous = createNode('key',0,0), node = createNode(kind,0,0), end = createNode('end',0,0)
 loop.items=['a','b']; loop.members=[previous.id,node.id]; node.text='BİTTİ var mı'; node.prompt='{{öğe}}'; node.keys='ENTER'; previous.keys='previous'
 return {nodes:[start,loop,previous,node,end], edges:[{id:'1',from:start.id,fromPort:'next',to:loop.id},{id:'2',from:previous.id,fromPort:'next',to:node.id},{id:'3',from:loop.id,fromPort:'done',to:end.id}]}
}
it.each(['click','type','key','condition','ai'] as const)('%s: random error retries only the current node, with the same item; prior nodes never replay',async kind=>{
 const g=graph(kind), node=g.nodes.find(n=>n.kind===kind&&n.keys!=='previous')!
 const seen:string[]=[], prior=vi.fn(async()=>{}); let calls=0
 const action=async(n:any)=>{seen.push(`${n.id}:${n.prompt}`); if(++calls<=2) throw Error('random transport fault')}
 const ex=base(); ex.key=async n=>n.keys==='previous'?prior():action(n)
 if(kind==='click') ex.click=action
 if(kind==='type') ex.type=action
 if(kind==='condition') ex.exists=async(_text,n)=>{await action(n);return false}
 if(kind==='ai') ex.initiative=async n=>{await action(n);return true}
 const statuses:string[]=[];ex.step=(_id,status)=>statuses.push(status)
 const pending=runGraph(g,ex,{maxSteps:20,stepDelayMs:0,reportEnd:true})
 await vi.advanceTimersByTimeAsync(7000)
 expect(await pending).toMatchObject({failed:0,reachedEnd:true})
 expect(seen.slice(0,3).every(value=>value.endsWith(':a'))).toBe(true);expect(seen[3].endsWith(':b')).toBe(true);expect(calls).toBe(4);expect(prior).toHaveBeenCalledTimes(2);expect(new Set(seen.slice(0,3).map(s=>s.split(':')[0]))).toEqual(new Set([node.id]));expect(statuses).not.toContain('error')
})
it('native uncertain delivery stays on this node without another dispatch; recovery may fail or remain undecided, then complete',async()=>{
 const g=graph('click'); const click=vi.fn(async()=>{throw Object.assign(Error('unknown native outcome'),{inputMayHaveBeenSent:true})});let attempts=0
 const ex=base();ex.click=click;ex.recover=async()=>{if(++attempts===1)throw Error('recovery offline');return attempts===2?undefined:'completed'}
 const pending=runGraph(g,ex,{maxSteps:20,stepDelayMs:0,reportEnd:true})
 await vi.advanceTimersByTimeAsync(13000)
 expect(await pending).toMatchObject({failed:0,reachedEnd:true}); expect(click).toHaveBeenCalledTimes(2) // once per item, never a duplicate
})
it('confirmed focus-only type progress resumes without dropping the progress checkpoint',async()=>{
 const n=createNode('type',0,0);n.text='abc';let calls=0
 const ex=base();ex.type=async live=>{if(++calls===1)throw Object.assign(Error('reader fault'),{typeProgress:{focus:'sent',text:'not_sent',enter:'not_sent',focusPoint:{x:10,y:20}}});expect(live.resumeTypeProgress?.focus).toBe('sent')}
 const pending=runGraph({nodes:[n],edges:[]},ex,{maxSteps:3,stepDelayMs:0})
 await vi.advanceTimersByTimeAsync(3000);expect((await pending).failed).toBe(0);expect(calls).toBe(2)
})
it('an undecided condition never takes its false port; Stop interrupts retry on the same node',async()=>{
 const n=createNode('condition',0,0);n.text='BİTTİ?';let stop=false
 const ex=base();ex.shouldStop=()=>stop;ex.exists=vi.fn(async()=>{throw Error('reader failed')})
 const pending=runGraph({nodes:[n],edges:[]},ex,{maxSteps:2,stepDelayMs:0})
 const checked=expect(pending).rejects.toBeInstanceOf(StoppedError)
 await vi.advanceTimersByTimeAsync(6100);expect(ex.exists).toHaveBeenCalledTimes(3);stop=true
 await vi.advanceTimersByTimeAsync(100);await checked
})
it('the shared method cycle retries a complete pass after arbitrary rejection values',async()=>{
 let calls=0; const retry=vi.fn()
 const pending=repeatMethodCycle(async()=>{if(++calls<4)throw null;return 7},{check:()=>{},wait:async()=>{await new Promise(r=>setTimeout(r,100))},retry})
 await vi.advanceTimersByTimeAsync(300);expect(await pending).toBe(7);expect(retry).toHaveBeenCalledTimes(3)
})

it('a valid deliberate model give-up is honored, unlike a failed model request',async()=>{
 const n=createNode('click',0,0),ex=base();ex.click=async()=>{throw Error('target missing')};ex.recover=async()=> 'stop'
 await expect(runGraph({nodes:[n],edges:[]},ex,{maxSteps:3,stepDelayMs:0})).rejects.toThrow('Model bilinçli olarak vazgeçti')
})
