import {afterEach,expect,it,vi} from 'vitest'
import {createNode} from '../electron/graph-types'
import {runYap} from '../electron/yap'
import {runGraph,StoppedError} from '../electron/runner'
const call=(name:string,args:object={})=>({role:'assistant' as const,content:null,tool_calls:[{id:'id-'+name,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
afterEach(()=>vi.useRealTimers())
it.each([false,true])('M2: 20 technical retries keep one bounded current observation; images=%s',async image=>{
 vi.useFakeTimers();let turns=0,reads=0
 const requests:string[]=[],execute=vi.fn(async(name:string)=>name==='act.key'?{ok:true,outcome:'tamam' as const,message:'ACTION_RESULT_SENTINEL'}:{ok:true,outcome:'tamam' as const,message:'refresh-'+(++reads),data:{description:'x'.repeat(40000),...(image?{image:{data:'AA==',mime:'image/png'}}:{})}})
 const pending=runYap({...createNode('ai',0,0),prompt:'ORIGINAL_TASK_SENTINEL',maxActions:2},{vars:{file:'CURRENT_ITEM'}},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:async({messages})=>{
  requests.push(JSON.stringify(messages));turns++
  if(turns===1)return call('act_key',{keys:'enter'})
  if(turns<=21)throw Error('temporary outage')
  return call('task_complete',{summary:'done'})
 }})
 await vi.advanceTimersByTimeAsync(60100);expect(await pending).toBe(true)
 expect(reads).toBe(20)
 expect(execute.mock.calls.filter(c=>c[0]==='act.key')).toHaveLength(1)
 const last=requests.at(-1)!
 expect(last).toContain('ORIGINAL_TASK_SENTINEL');expect(last).toContain('ACTION_RESULT_SENTINEL');expect(last).toContain('CURRENT_ITEM')
 expect(last.match(/currentObservation/g)).toHaveLength(1)
 expect(last.length-requests[1].length).toBeLessThan(31000)
 expect(Math.max(...requests.map(s=>s.length))).toBeLessThan(33000)
})
it('M2: Stop can end an arbitrarily long technical retry without replaying an action',async()=>{
 vi.useFakeTimers();let stopped=false,reads=0
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:String(++reads)}))
 const pending=runYap(createNode('ai',0,0),{},{shouldStop:()=>stopped,log:()=>{},makeExecute:()=>execute,turn:async()=>{throw Error('offline')}})
 const rejected=expect(pending).rejects.toBeInstanceOf(StoppedError)
 await vi.advanceTimersByTimeAsync(6100);stopped=true;await vi.advanceTimersByTimeAsync(100);await rejected
 expect(reads).toBe(2)
})
it('M3: wait consumes action budget but does not claim that native input may have been sent',async()=>{
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:'wait complete'}))
 const error=await runYap({...createNode('ai',0,0),maxActions:1},{},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:async()=>call('act_wait',{ms:1})}).catch(e=>e)
 expect(error.message).toContain('sınırında');expect(error.inputMayHaveBeenSent).not.toBe(true)
 expect(execute).toHaveBeenCalledExactlyOnceWith('act.wait',{ms:1})
})
it('M3: real input followed by wait still preserves the no-replay input flag',async()=>{
 let turns=0
 const error=await runYap({...createNode('ai',0,0),maxActions:2},{},{shouldStop:()=>false,log:()=>{},makeExecute:()=>async()=>({ok:true,outcome:'tamam',message:'sent'}),turn:async()=>++turns===1?call('act_key',{keys:'enter'}):call('act_wait',{ms:1})}).catch(e=>e)
 expect(error.inputMayHaveBeenSent).toBe(true)
})
it('M3: runner can re-enter a wait-only failed Yap after Recovery retries, then finish the graph',async()=>{
 vi.useFakeTimers();let entries=0,turns=0
 const node={...createNode('ai',0,0),maxActions:1,prompt:'wait then observe'}
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:'completed'}))
 const initiative=vi.fn(async()=>{
  entries++
  return runYap(node,{},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:async()=>entries===1?call('act_wait',{ms:1}):++turns===1?call('screen_read'):call('task_complete',{summary:'done'})})
 })
 const recover=vi.fn(async()=> 'retry' as const)
 const pending=runGraph({nodes:[node],edges:[]},{shouldStop:()=>false,log:()=>{},step:()=>{},click:async()=>{},key:async()=>{},type:async()=>{},exists:async()=>false,initiative,recover},{maxSteps:10,stepDelayMs:0})
 await vi.advanceTimersByTimeAsync(3100)
 expect((await pending).failed).toBe(0);expect(initiative).toHaveBeenCalledTimes(2);expect(recover).toHaveBeenCalledOnce()
 expect(execute.mock.calls).toEqual([['act.wait',{ms:1}],['screen.read',{}]])
})
