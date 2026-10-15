import {afterEach,expect,it,vi} from 'vitest'
import {runYap} from '../electron/yap'
import {recoveryToolTurn,setStopCheck} from '../electron/openrouter'
import {createNode} from '../electron/graph-types'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();setStopCheck(()=>false)})
it('Yap exhausts model alternatives, refreshes only its observation, then asks again without replaying actions',async()=>{
 vi.useFakeTimers();const bodies:any[]=[]
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return bodies.length<3?{ok:false,status:503,text:async()=> 'offline'}:{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'done',type:'function',function:{name:'task_complete',arguments:JSON.stringify({summary:'done'})}}]},finish_reason:'tool_calls'}]})}}))
 const execute=vi.fn(async()=>({ok:true,outcome:'tamam' as const,message:'fresh-read',data:{image:{data:'AA==',mime:'image/png'}}}))
 const pending=runYap({...createNode('ai',0,0),prompt:'fixture'}, {},{shouldStop:()=>false,log:()=>{},makeExecute:()=>execute,turn:args=>recoveryToolTurn({...args,stage:'yap',models:['A','B'],apiKey:'fixture'})})
 await vi.advanceTimersByTimeAsync(3100);expect(await pending).toBe(true)
 expect(bodies.map(body=>body.model)).toEqual(['A','B','A']);expect(execute).toHaveBeenCalledExactlyOnceWith('screen.read',{})
 expect(JSON.stringify(bodies[2].messages)).toContain('fresh-read')
})
it('Yap honors a deliberate give-up after a valid current observation',async()=>{
 let calls=0
 const tool=(name:string,args:any)=>({role:'assistant' as const,content:null,tool_calls:[{id:'1',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
 await expect(runYap({...createNode('ai',0,0),prompt:'fixture'}, {},{shouldStop:()=>false,log:()=>{},makeExecute:()=>async()=>({ok:true,outcome:'tamam',message:'current screen'}),turn:async()=>++calls===1?tool('screen_read',{}):tool('task_give_up',{reason:'The requested target is not present.'})})).rejects.toThrow('Model bilinçli olarak vazgeçti')
 expect(calls).toBe(2)
})
