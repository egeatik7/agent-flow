import {afterEach,expect,it,vi} from 'vitest'
import {recoveryToolTurn,setLocalEndpoint,setStopCheck,FatalApiError} from '../electron/openrouter'
import type {ToolMessage} from '../electron/openrouter'
import {createNode} from '../electron/graph-types'
import {runYap} from '../electron/yap'
import {StoppedError} from '../electron/runner'
const ok=(message:unknown)=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message,finish_reason:'stop'}]})})
const tool=(name:string,args:object)=>({role:'assistant' as const,content:null,tool_calls:[{id:'call-'+name,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
const base={apiKey:'fixture',models:['remote/primary','remote/same-account','local:healthy'],allowLocal:true,stage:'yap',messages:[] as ToolMessage[],tools:[],timeoutMs:300000,shouldStop:()=>false}
afterEach(()=>{vi.unstubAllGlobals();setLocalEndpoint('');setStopCheck(()=>false)})
it.each([401,402])('M1: HTTP %s skips the rejected account but reaches the independent local backup',async status=>{
 setLocalEndpoint('http://localhost:11434/v1',180000,true)
 const bodies:any[]=[],urls:string[]=[]
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{urls.push(String(url));const b=JSON.parse(init.body);bodies.push(b);return b.model==='remote/primary'?{ok:false,status,text:async()=>status===401?'unauthorized':'insufficient credits'}:ok({content:'ready'})}))
 expect((await recoveryToolTurn(base)).content).toBe('ready')
 expect(bodies.map(b=>b.model)).toEqual(['remote/primary','healthy'])
 expect(urls[1]).toBe('http://localhost:11434/v1/chat/completions')
 expect(vi.mocked(fetch).mock.calls[1][1]?.headers).not.toHaveProperty('Authorization')
})
it('M1: a healthy first model still wins without calling any backup',async()=>{
 const fetch=vi.fn(async()=>ok({content:'ready'}));vi.stubGlobal('fetch',fetch)
 expect((await recoveryToolTurn(base)).content).toBe('ready');expect(fetch).toHaveBeenCalledTimes(1)
})
it('M1: recovery keeps its existing fatal-account policy',async()=>{
 const fetch=vi.fn(async()=>({ok:false,status:402,text:async()=> 'insufficient credits'}));vi.stubGlobal('fetch',fetch)
 await expect(recoveryToolTurn({...base,stage:'recovery'})).rejects.toBeInstanceOf(FatalApiError)
 expect(fetch).toHaveBeenCalledTimes(1)
})
it('M1: Stop during a rejected remote response prevents local fallback',async()=>{
 let stop=false;const fetch=vi.fn(async()=>{stop=true;return{ok:false,status:402,text:async()=> 'insufficient credits'}});vi.stubGlobal('fetch',fetch)
 await expect(recoveryToolTurn({...base,shouldStop:()=>stop})).rejects.toBeInstanceOf(StoppedError)
 expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([null,'','   ',[{type:'text',text:'  '}]])('N09: empty primary content %j advances to a healthy backup',async content=>{
 const models:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const b=JSON.parse(init.body);models.push(b.model);return ok({content:b.model==='empty'?content:'ready',tool_calls:[]})}))
 expect((await recoveryToolTurn({...base,models:['empty','backup']})).content).toBe('ready')
 expect(models).toEqual(['empty','backup'])
})
it('N09: null content with a valid tool call remains a valid native tool answer',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>ok(tool('act_wait',{ms:1}))))
 const tools=[{type:'function' as const,function:{name:'act_wait',description:'wait',parameters:{type:'object',properties:{ms:{type:'integer'}},required:['ms'],additionalProperties:false}}}]
 expect((await recoveryToolTurn({...base,models:['first'],tools})).tool_calls?.[0].function.name).toBe('act_wait')
})
it('N09: an empty first model cannot burn 40 Yap turns before a backup completes the task',async()=>{
 const models:string[]=[];let backupTurns=0
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const b=JSON.parse(init.body);models.push(b.model)
  return ok(b.model==='empty'?{content:null}:++backupTurns===1?tool('screen_read',{}):tool('task_complete',{summary:'done'}))
 }))
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:'screen read'}))
 expect(await runYap({...createNode('ai',0,0),maxActions:1,prompt:'Read status'}, {},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:args=>recoveryToolTurn({...args,apiKey:'fixture',models:['empty','healthy'],stage:'yap'})})).toBe(true)
 expect(models).toEqual(['empty','healthy','empty','healthy'])
 expect(execute.mock.calls).toEqual([['screen.read',{}],['screen.read',{}]])
})
const transcript:ToolMessage[]=[{role:'system',content:'task rules'},{role:'tool',tool_call_id:'read',content:'OCR: target is visible; coordinates 10,20'},{role:'user',content:[{type:'text',text:'Current screen and cursor metadata'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}]
it.each([false,true])('N04: Yap reaches completion after screen_read with localVision=%s',async vision=>{
 setLocalEndpoint('http://localhost:11434/v1',180000,vision)
 const bodies:any[]=[]
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{bodies.push(JSON.parse(init.body));return ok(bodies.length===1?tool('screen_read',{}):tool('task_complete',{summary:'observed result'}))}))
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:'OCR reader succeeded',data:{text:'Target visible, OCR preserved',image:{data:'AA==',mime:'image/png'}}}))
 expect(await runYap({...createNode('ai',0,0),prompt:'observe target'}, {},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:args=>recoveryToolTurn({...args,apiKey:'',models:['local:fixture'],allowLocal:true,stage:'yap'})})).toBe(true)
 expect(bodies).toHaveLength(2);expect(execute).toHaveBeenCalledTimes(2)
 const second=JSON.stringify(bodies[1].messages)
 expect(second).toContain('Target visible, OCR preserved')
 expect(second.includes('image_url')).toBe(vision)
})
it('N04: text adaptation preserves messages and tool IDs; a remote backup still gets the original image',async()=>{
 setLocalEndpoint('http://localhost:11434/v1',180000,false)
 const original=structuredClone(transcript),bodies:any[]=[]
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const b=JSON.parse(init.body);bodies.push(b);return b.model==='text-only'?{ok:false,status:503,text:async()=> 'temporarily unavailable'}:ok({content:'ready'})}))
 expect((await recoveryToolTurn({...base,models:['local:text-only','remote/backup'],messages:transcript})).content).toBe('ready')
 expect(JSON.stringify(bodies[0].messages)).not.toContain('image_url')
 expect(JSON.stringify(bodies[0].messages)).toContain('Current screen and cursor metadata')
 expect(bodies[0].messages[1]).toEqual(transcript[1])
 expect(bodies[1].messages).toEqual(original);expect(transcript).toEqual(original)
})
it('N04: a pure image part becomes an explicit unavailable-image note, not fake visual evidence',async()=>{
 setLocalEndpoint('http://localhost:11434/v1',180000,false)
 let body:any;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{body=JSON.parse(init.body);return ok({content:'ready'})}))
 await recoveryToolTurn({...base,models:['local:text-only'],messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}]})
 expect(typeof body.messages[0].content).toBe('string');expect(body.messages[0].content).toContain('gönderilmedi')
})
it('N04: recovery with images retains its previous unsupported-vision behavior',async()=>{
 setLocalEndpoint('http://localhost:11434/v1',180000,false)
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(recoveryToolTurn({...base,stage:'recovery',models:['local:text-only'],messages:transcript})).rejects.toThrow('görüntü desteği kapalı')
 expect(fetch).not.toHaveBeenCalled()
})
