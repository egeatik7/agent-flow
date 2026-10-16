// @vitest-environment jsdom
// Regressions for the independently reproduced audit findings.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createNode, DEFAULT_SETTINGS, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, isApiDown, StoppedError, type Executor } from '../electron/runner'
import { runModelChain, ModelFailed, setStopCheck, setLocalEndpoint, setChatLogger, chooseTypeField, visionCheck, parseJsonAction, validateApiKey, responseText, ModelRejected } from '../electron/openrouter'
import { packageSelection } from '../src/lib/graph-ops'
import { recoveryReportIndex } from '../src/lib/recovery-report-view'
import { profileDirName } from '../electron/profile'
import LlmPanel from '../src/components/LlmPanel'
import LocalModelSettings from '../src/components/LocalModelSettings'
import RecoverySettingsPanel from '../src/components/RecoverySettingsPanel'
import { runRecovery } from '../electron/recovery'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'

let mounted: ReactTestRenderer | undefined
afterEach(() => {
  if (mounted) act(() => mounted!.unmount())
  mounted = undefined
  setStopCheck(() => false); setChatLogger(null); setLocalEndpoint('')
  vi.useRealTimers(); vi.unstubAllGlobals()
})
let seq=0
const edge=(a:AgentNode,p:string,b:AgentNode)=>({id:`audit-${seq++}`,from:a.id,fromPort:p,to:b.id})
const fake=()=>{
  const actions:string[]=[]; const logs:{level:string,message:string}[]=[]
  const ex:Executor={log:(level,message)=>logs.push({level,message}),step:()=>{},shouldStop:()=>false,
    click:async n=>{actions.push(n.prompt??n.title)},type:async()=>{},key:async()=>{},exists:async()=>false}
  return {ex,actions,logs}
}
const opts={debug:true,maxSteps:3,stepDelayMs:0}
const ask=()=>chooseTypeField({apiKey:'synthetic',model:['audit/model'],step:'type',instruction:'',text:'x',ahead:'',choices:[]})

describe('independent code audit reproductions',()=>{
  it('A1: transient failure stops at an explicit total cycle bound',async()=>{
    const run=vi.fn(async()=>{throw new ModelFailed('outage')})
    await expect(runModelChain(['audit'],run,0,{maxCycles:3})).rejects.toThrow('deneme sınırı')
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('A2: user target Bakiye Sorgula / quota is not an API outage',()=>{
    expect(isApiDown('“Bakiye Sorgula” ekranda bulunamadı.')).toBe(false)
    expect(isApiDown('“Quota Settings” ekranda bulunamadı.')).toBe(false)
  })
  it('A3: a permanently missing target with item-dependent error processes every item',async()=>{
    const s=createNode('start',0,0),l=createNode('loop',100,0),c=createNode('click',200,0)
    l.items=['a.png','b.png','c.png','d.png'];l.members=[c.id];c.prompt='{{öğe}}'
    const f=fake();f.ex.click=async n=>{f.actions.push(n.prompt!);throw new Error(`“${n.prompt}” ekranda bulunamadı. Ekran: example`)}
    const r=await runGraph({nodes:[s,l,c],edges:[edge(s,'next',l)]},f.ex,opts)
    expect(f.actions).toEqual(l.items);expect(r.failed).toBe(4)
  })
  it('A4: packaging rejects an unreachable loop-member external exit',async()=>{
    const s=createNode('start',0,0),l=createNode('loop',100,0),c=createNode('click',200,0),out=createNode('click',400,0)
    l.count=1;l.members=[c.id];c.prompt='inner';out.prompt='outside'
    const graph={nodes:[s,l,c,out],edges:[edge(s,'next',l),edge(c,'next',out)]}
    const unpacked=fake();await runGraph(structuredClone(graph),unpacked.ex,opts)
    expect(unpacked.actions).toEqual(['inner']) // this boundary is already ignored before packaging
    expect(packageSelection(graph,[l.id,c.id])).toBeNull()
  })
  it('A5: loop-box cycle is bounded while lap step budgets remain independent',async()=>{
    const s=createNode('start',0,0),l=createNode('loop',100,0),c=createNode('click',200,0)
    l.count=1;l.members=[c.id];c.prompt='click'
    const f=fake();f.ex.shouldStop=()=>f.actions.length>=12
    await expect(runGraph({nodes:[s,l,c],edges:[edge(s,'next',l),edge(l,'done',l)]},f.ex,opts)).rejects.toThrow('adım/kutu çağrısı')
    expect(f.actions.length).toBe(2)
  })
  it('B4 (1.9.154): unconnected instant "no" with recovery off stops the run; no action is invented',async()=>{
    const s=createNode('start',0,0),c=createNode('condition',100,0);c.text='Ready';c.timeoutMs=0
    const f=fake()
    await expect(runGraph({nodes:[s,c],edges:[edge(s,'next',c)]},f.ex,{...opts,reportEnd:true})).rejects.toThrow('kurtarma ajanı kapalı')
    expect(f.actions).toEqual([])
  })
  it('B4 (1.9.154): legacy condition timeout is ignored; one unconnected "no" with recovery off stops the run',async()=>{
    const s=createNode('start',0,0),c=createNode('condition',100,0);c.text='Ready';c.timeoutMs=1
    const f=fake()
    await expect(runGraph({nodes:[s,c],edges:[edge(s,'next',c)]},f.ex,{...opts,reportEnd:true})).rejects.toThrow('kurtarma ajanı kapalı')
  })
  it('B5: captureFailure rejection is logged and the original item result is preserved',async()=>{
    const s=createNode('start',0,0),l=createNode('loop',100,0),c=createNode('click',200,0)
    l.items=['a'];l.members=[c.id];const f=fake();f.ex.click=async()=>{throw new Error('missing')}
    f.ex.captureFailure=async()=>{throw new Error('AUDIT_DISK_WRITE_FAILED')}
    const r=await runGraph({nodes:[s,l,c],edges:[edge(s,'next',l)]},f.ex,opts)
    expect(r.failed).toBe(1);expect(f.logs.some(l=>l.message.includes('AUDIT_DISK_WRITE_FAILED'))).toBe(true)
  })
  it('C1: malformed synthetic key is rejected before fetch without leaking in logs',async()=>{
    vi.useFakeTimers();const logs:string[]=[]
    const synthetic='sk-SYNTHETIC-AUDIT\nsk-SYNTHETIC-AUDIT'
    const fetch=vi.fn();setChatLogger(s=>logs.push(s));vi.stubGlobal('fetch',fetch)
    expect(()=>validateApiKey(synthetic)).toThrow('kontrol karakteri')
    const p=chooseTypeField({apiKey:synthetic,model:['audit/model'],step:'type',instruction:'',text:'x',ahead:'',choices:[]})
    const assertion=expect(p).rejects.toThrow()
    await vi.runAllTimersAsync();await assertion
    expect(fetch).not.toHaveBeenCalled();expect(logs.join(' ')).not.toContain('sk-SYNTHETIC-AUDIT')
  })
  it('C3: JSON coordinate 1 follows the explicit 0–1000 contract',()=>{
    expect(parseJsonAction('{"action":"click","x":1,"y":500}')).toMatchObject({x:.001,y:.5})
  })
  it('C4: localVision=false rejects vision-only calls without sending an image',async()=>{
    setLocalEndpoint('http://localhost:1234/v1',undefined,false)
    const bodies:any[]=[];vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{
      bodies.push(JSON.parse(String(init.body)))
      return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{"answer":true}'}}]})}
    })
    vi.useFakeTimers()
    const pending=visionCheck({apiKey:'',model:'local:audit',question:'Ready?',image:{data:'AA==',w:1,h:1,mime:'image/png'}})
    const assertion=expect(pending).rejects.toThrow()
    await vi.runAllTimersAsync();await assertion
    expect(bodies).toHaveLength(0)
  })
  it('D1: unrelated settings update preserves the unsaved LLM prompt',()=>{
    const p={settings:structuredClone(DEFAULT_SETTINGS),onSave:vi.fn()}
    act(()=>{mounted=create(createElement(LlmPanel,p))})
    act(()=>mounted!.root.findAllByType('textarea')[0].props.onChange({target:{value:'AUDIT_UNSAVED_PROMPT'}}))
    expect(mounted!.root.findAllByType('textarea')[0].props.value).toBe('AUDIT_UNSAVED_PROMPT')
    act(()=>mounted!.update(createElement(LlmPanel,{...p,settings:{...p.settings,stepDelayMs:42}})))
    expect(mounted!.root.findAllByType('textarea')[0].props.value).toBe('AUDIT_UNSAVED_PROMPT')
  })
  it('D5 local: typing 3 then 30 remains editable until blur',()=>{
    const Host=()=>{const [s,setSettings]=useState(structuredClone(DEFAULT_SETTINGS));return createElement(LocalModelSettings,{settings:s,setSettings,onSave:()=>{},models:[]})}
    act(()=>{mounted=create(createElement(Host))})
    act(()=>mounted!.root.findAllByType('input').find(x=>x.props.id==='local-timeout')!.props.onChange({target:{value:'3'}}))
    expect(mounted!.root.findAllByType('input').find(x=>x.props.id==='local-timeout')!.props.value).toBe('3')
    act(()=>mounted!.root.findAllByType('input').find(x=>x.props.id==='local-timeout')!.props.onChange({target:{value:'30'}}))
    act(()=>mounted!.root.findAllByType('input').find(x=>x.props.id==='local-timeout')!.props.onBlur())
    expect(mounted!.root.findAllByType('input').find(x=>x.props.id==='local-timeout')!.props.value).toBe('30')
  })
  it('D5 recovery: typing 3 then 30 remains editable until blur',async()=>{
    const Host=()=>{const[s,setSettings]=useState(structuredClone(DEFAULT_SETTINGS));return createElement(RecoverySettingsPanel,{settings:s,setSettings,onSave:()=>{},graph:{nodes:[],edges:[]},models:[],onLoadModels:()=>{}})}
    await act(async()=>{mounted=create(createElement(Host))})
    const input=()=>mounted!.root.findAllByType('input').find(x=>x.props.min===10&&x.props.max===900)!
    act(()=>input().props.onChange({target:{value:'3'}}))
    expect(input().props.value).toBe('3')
    act(()=>input().props.onBlur());expect(input().props.value).toBe('10')
  })
  it('D7: a canvas-less legacy report does not leak into scoped canvases',()=>{
    const n=createNode('click',0,0);const report:any={id:'report',startedAt:1,nodeId:n.id,result:'failed'}
    expect(recoveryReportIndex({nodes:[n],edges:[]},[report],'other-canvas').get(n.id)).toHaveLength(0)
  })
  it('Q1: content arrays support plain text and reject malformed parts permanently',()=>{
    expect(responseText([{type:'text',text:'one'},{type:'text',text:'two'}])).toBe('one\ntwo')
    expect(()=>responseText([{type:'text',text:42}])).toThrow(ModelRejected)
  })
  it('Q1: provider text array is parsed in one request',async()=>{
    const fetch=vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:[{type:'text',text:'{"id":null}'}]}}]})}))
    vi.stubGlobal('fetch',fetch);await expect(ask()).resolves.toMatchObject({id:null});expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Q2: data.error string preserves the actual provider failure',async()=>{
    vi.useFakeTimers();const logs:string[]=[];setChatLogger(s=>logs.push(s));let calls=0
    vi.stubGlobal('fetch',async()=>{calls++;return{ok:true,status:200,text:async()=>JSON.stringify({error:'AUDIT_INVALID_REQUEST'})}})
    const p=ask();const assertion=expect(p).rejects.toThrow()
    await vi.runAllTimersAsync();await assertion
    expect(calls).toBe(1);expect(logs.join('\n')).toContain('AUDIT_INVALID_REQUEST')
  })
  it('B2: recovery honors explicit sent:false for move-only steps',async()=>{
    const node={...createNode('click',0,0),clickMode:'move' as const};let turn=0;const logs:any[]=[]
    const request={graph:{nodes:[node],edges:[]},node,live:node,error:new Error('missing'),stepNo:1,ahead:{},vars:{}}
    const out=await runRecovery(request,{settings:{...DEFAULT_RECOVERY,enabled:true,maxCalls:3},shouldStop:()=>false,log:()=>{},recentLog:[],saveReport:()=>{},
      makeExecute:()=>async()=>({ok:true,outcome:'tamam',message:'pointer moved',data:{sent:false}}),
      turn:async(args:any)=>{
        logs.push(structuredClone(args.messages));const name=turn++===0?'step_run':turn===2?'recovery_retry':'recovery_stop'
        return{role:'assistant',content:null,tool_calls:[{id:`call-${turn}`,type:'function',function:{name,arguments:JSON.stringify(name==='step_run'?{nodeId:node.id}:{probableCause:'audit',evidence:'audit',summary:'audit'})}}]} as any
      }})
    expect(out.decision).toBe('retry')
    expect(logs.at(-1).some((m:any)=>m.role==='tool'&&m.content.includes('girdisi zaten gönderildi'))).toBe(false)
  })
})
