import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({ stop:false, stopOnRetry:false, logs:[] as string[], scans:[] as any[], keys:[] as string[], failKey:false, visible:false, inputs:[] as string[] }))
vi.mock('electron',()=>({ screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1000,height:700},scaleFactor:1})} }))
vi.mock('../electron/a11y-bridge',()=>({
 isLocked:async()=>false, discardShot:()=>{}, foreground:async()=>({title:'Fixture',pid:1,hwnd:'42',proc:'fixture'}),
 scan:async(o:any)=>{h.scans.push(o);return {area:{x:0,y:0,w:1000,h:700},window:'Fixture',image:{data:'AA==',w:1000,h:700},items:[{id:1,src:'ocr',type:'Text',text:h.visible?'Run':'Unrelated obstruction',x:100,y:100,w:100,h:30}],ocr:true,uiaCount:0,ocrCount:1}},
 sendKeys:async(keys:string)=>{ if(h.failKey){h.failKey=false;throw Error('worker unavailable before dispatch')} h.keys.push(keys) },
 clickAt:async()=>{h.inputs.push('click')}, clickCurrentAt:async()=>{h.inputs.push('visual')},
}))
vi.mock('../electron/browser',()=>({ userChromeItems:async()=>null }))
vi.mock('../electron/shots',()=>({ rememberShot:()=>{} }))
vi.mock('../electron/local-context-probe',async original=>({...await original<any>(),olcumuTazele:async()=>{}}))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { runGraph, StoppedError, type RecoveryRequest } from '../electron/runner'
import { DeliberateStopError, RecoveryFailedError } from '../electron/method-cycle'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import { runRecovery } from '../electron/recovery'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import type { ToolContext } from '../electron/tools'
const settings=()=>({...DEFAULT_SETTINGS,apiKey:'fixture',model:'vision',visionModel:'vision',visionBackups:[],findOrder:['tars','windows','list'] as typeof DEFAULT_SETTINGS.findOrder,findOff:[],screenCheck:'off' as const,stepDelayMs:0,recovery:{...DEFAULT_RECOVERY,enabled:true,allowDesktop:true}})
const agent=(extra={})=>createAgent({settings:()=>({...settings(),...extra}), shouldStop:()=>h.stop, log:(_l,line)=>{h.logs.push(line);if(h.stopOnRetry&&line.includes('YONTEM-TUR'))h.stop=true},send:()=>{}}).executor
const reply=(content:any)=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]})})
const target=()=>({...createNode('click',0,0),prompt:'CustomRemesh panelindeki “Run Remesh for multiple objects” düğmesine BİR KEZ tıkla.'})
const opts={maxSteps:10,stepDelayMs:0}
beforeEach(()=>{Object.assign(h,{stop:false,stopOnRetry:false,logs:[],scans:[],keys:[],failKey:false,visible:false,inputs:[]});vi.useFakeTimers();setStopCheck(()=>h.stop);setLocalEndpoint('')})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();setStopCheck(()=>false);setLocalEndpoint('')})
it('visual terminate plus ordinary OCR null reaches Recovery and completes without sending the original click',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>reply(++calls===1?{name:'computer_use',arguments:{action:'terminate',status:'failure'}}:{id:null,text:'',reason:'CustomRemesh is not visible in the current screenshot'})))
 const ex=agent(),recover=vi.fn(async(_request: RecoveryRequest)=> 'completed' as const);ex.recover=recover
 await expect(runGraph({nodes:[target()],edges:[]},ex,opts)).resolves.toMatchObject({failed:0})
 expect(calls).toBe(2);expect(recover).toHaveBeenCalledOnce();expect(recover.mock.calls[0][0].error).not.toBeInstanceOf(DeliberateStopError);expect(h.inputs).toEqual([])
})
it('control: an ordinary pre-dispatch key error reaches enabled recovery',async()=>{
 const node={...createNode('key',0,0),keys:'alt+tab'};h.failKey=true
 const ex=agent(),recover=vi.fn(async()=> 'completed' as const);ex.recover=recover
 await expect(runGraph({nodes:[node],edges:[]},ex,opts)).resolves.toMatchObject({failed:0})
 expect(recover).toHaveBeenCalledOnce();expect(h.keys).toEqual([])
})
it('ordinary null-only missing target reaches Recovery instead of being trapped in an inner retry loop',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null,text:'',reason:'target temporarily covered'})))
 const ex=agent({findOrder:['list']}),recover=vi.fn(async()=> 'completed' as const);ex.recover=recover
 await expect(runGraph({nodes:[target()],edges:[]},ex,opts)).resolves.toMatchObject({failed:0})
 expect(recover).toHaveBeenCalledOnce();expect(h.inputs).toEqual([])
})
it.each(['disabled', undefined] as const)('Recovery %s stops with an explicit unavailable message, never deliberate give-up',async decision=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null})))
 const ex=agent({findOrder:['list']});ex.recover=vi.fn(async()=>decision)
 const error=await runGraph({nodes:[target()],edges:[]},ex,opts).catch(e=>e)
 expect(error).toBeInstanceOf(RecoveryFailedError);expect(error).not.toBeInstanceOf(DeliberateStopError)
 expect(error.message).toContain('Kurtarma aşamasına ulaşıldı');expect(error.message).toContain('kapalı')
 expect(ex.recover).toHaveBeenCalledOnce();expect(h.inputs).toEqual([])
})
it('only an explicit Recovery stop creates deliberate give-up',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null,give_up:true,reason:'not visible'})))
 const ex=agent({findOrder:['list']});ex.recover=vi.fn(async()=> 'stop' as const)
 await expect(runGraph({nodes:[target()],edges:[]},ex,opts)).rejects.toBeInstanceOf(DeliberateStopError)
 expect(ex.recover).toHaveBeenCalledOnce();expect(h.inputs).toEqual([])
})
it('Recovery failure and a rejected recovery call stop without a deliberate classification',async()=>{
 for(const fail of [false,true]){
  vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null})))
  const ex=agent({findOrder:['list']});ex.recover=vi.fn(async()=>{if(fail)throw Error('recovery offline');return 'failed' as const})
  const error=await runGraph({nodes:[target()],edges:[]},ex,opts).catch(e=>e)
  expect(error).toBeInstanceOf(RecoveryFailedError);expect(error).not.toBeInstanceOf(DeliberateStopError)
  expect(ex.recover).toHaveBeenCalledOnce()
 }
})
it('Stop during handoff remains user Stop and never starts another method pass',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null})))
 const ex=agent({findOrder:['list']});ex.recover=vi.fn(async()=>{h.stop=true;return 'retry' as const})
 await expect(runGraph({nodes:[target()],edges:[]},ex,opts)).rejects.toBeInstanceOf(StoppedError)
 expect(ex.recover).toHaveBeenCalledOnce()
})
it('available recovery desktop key tool can send ESC without replaying the missing click node',async()=>{
 const node=target(),request:RecoveryRequest={graph:{nodes:[node],edges:[]},node,live:node,error:Error('target obscured'),stepNo:177,ahead:{},vars:{}}
 const base={getSettings:settings,log:()=>{}} as unknown as ToolContext
 const result=await recoveryExecutor(request,base,()=>false,agent())('act.key',{keys:'ESC'})
 expect(result.ok).toBe(true);expect(result.data).toMatchObject({sent:true,inputKind:'key'});expect(h.keys).toEqual(['ESC']);expect(h.inputs).toEqual([])
})
it('a successful Alt+Tab key node does not itself inspect whether the switcher closed',async()=>{
 const node={...createNode('key',0,0),keys:'alt+tab'}
 await runGraph({nodes:[node],edges:[]},agent(),opts)
 expect(h.keys).toEqual(['alt+tab']);expect(h.scans).toEqual([])
})

it('a full recovery observes an obstruction, acts, then retries the original target on a fresh screen',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply(h.visible?{id:1,text:'Run'}:{id:null,reason:'target covered'})))
 const node={...target(),prompt:'Run'}, ex=agent({findOrder:['list']})
 const tool=(name:string,args={})=>({role:'assistant' as const,content:null,tool_calls:[{id:name,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
 const answers=[tool('screen_read'),tool('act_key',{keys:'ESC'}),tool('screen_read'),tool('recovery_retry',{probableCause:'obstruction',evidence:'current screen',summary:'obstruction removed'})]
 const execute=vi.fn(async(name:string)=>{if(name==='act.key')h.visible=true;return {ok:true,outcome:'tamam' as const,message:'fixture observation/action'}})
 ex.recover=vi.fn(async request=>(await runRecovery(request,{settings:settings().recovery,shouldStop:()=>h.stop,log:()=>{},recentLog:[],saveReport:()=>{},makeExecute:()=>execute,turn:async()=>answers.shift()!})).decision)
 const pending=runGraph({nodes:[node],edges:[]},ex,opts)
 await vi.advanceTimersByTimeAsync(4000)
 await expect(pending).resolves.toMatchObject({failed:0})
 expect(ex.recover).toHaveBeenCalledOnce()
 expect(execute.mock.calls.map(([name])=>name)).toEqual(['screen.read','act.key','screen.read'])
 expect(h.inputs).toEqual(['click']);expect(h.scans.every(s=>s.fresh)).toBe(true)
})
