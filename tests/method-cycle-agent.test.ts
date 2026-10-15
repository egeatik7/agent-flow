import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({scans:[] as any[],point:{x:0,y:0},inputs:[] as string[],stop:false,logs:[] as string[]}))
vi.mock('electron',()=>({screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1000,height:700},scaleFactor:1})}}))
vi.mock('../electron/a11y-bridge',()=>({
 isLocked:async()=>false,discardShot:()=>{},
 foreground:async()=>({title:'Fixture',pid:1,hwnd:'42',proc:'fixture'}),
 scan:async(o:any)=>{h.scans.push(o);return {area:{x:0,y:0,w:1000,h:700},window:'Fixture',image:{data:'AA==',w:1000,h:700},cursor:{...h.point},items:[{id:1,src:'uia',type:'Button',text:'Run',x:100,y:100,w:100,h:30},{id:2,src:'ocr',type:'Text',text:'BİTTİ',x:300,y:100,w:100,h:30}],ocr:true,uiaCount:1,ocrCount:1}},
 moveMouse:async(x:number,y:number)=>{h.point={x,y};return {hwnd:42}},cursorPos:async()=>({...h.point}),
 clickAt:async()=>{h.inputs.push('direct');return {}},clickCurrentAt:async()=>{h.inputs.push('visual');return {}},
}))
vi.mock('../electron/browser',()=>({userChromeItems:async()=>null}))
vi.mock('../electron/shots',()=>({rememberShot:()=>{}}))
vi.mock('../electron/local-context-probe',async original=>({...await original<any>(),olcumuTazele:async()=>{}}))
import {createAgent} from '../electron/agent'
import {createNode,DEFAULT_SETTINGS} from '../electron/graph-types'
import {runGraph} from '../electron/runner'
import {setLocalEndpoint,setStopCheck} from '../electron/openrouter'
const retryClick = (ex: ReturnType<typeof agent>, node: ReturnType<typeof createNode>) => {
 ex.recover = async () => 'retry'
 return runGraph({nodes:[node],edges:[]},ex,{maxSteps:10,stepDelayMs:0})
}
const reply=(content:any)=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]})})
const agent=(extra={})=>createAgent({settings:()=>({...DEFAULT_SETTINGS,apiKey:'fake',model:'vision',visionModel:'vision',visionBackups:[],findOrder:['list','uia'],findOff:[],screenCheck:'off',...extra}),shouldStop:()=>h.stop,log:(_l,line)=>h.logs.push(line),send:()=>{}}).executor
beforeEach(()=>{h.scans=[];h.logs=[];h.inputs=[];h.point={x:0,y:0};h.stop=false;vi.useFakeTimers();setStopCheck(()=>h.stop);setLocalEndpoint('')})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();setStopCheck(()=>false);setLocalEndpoint('')})
it('a failed first condition method advances to OCR instead of repeating the same model request',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?{ok:false,status:503,text:async()=> 'offline'}:reply({satisfied:true,id:2})))
 expect(await agent().exists('',{...createNode('condition',0,0),text:'BİTTİ var mı?'})).toBe(true)
 expect(calls).toBe(2);expect(h.scans.map(o=>[o.uia,o.ocr])).toEqual([[true,false],[false,true]])
})
it('a negative reader plus a failed reader starts a whole fresh method pass, then accepts a valid result',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?{ok:false,status:503,text:async()=> 'offline'}:calls===2?reply({satisfied:false,id:null}):reply({satisfied:true,id:1})))
 const pending=agent().exists('',{...createNode('condition',0,0),text:'BİTTİ var mı?'})
 await vi.advanceTimersByTimeAsync(3000);expect(await pending).toBe(true)
 expect(h.scans.map(o=>[o.uia,o.ocr])).toEqual([[true,false],[false,true],[true,false]])
 expect(h.scans.every(o=>o.fresh===true)).toBe(true)
})
it('a full 180s model timeout advances methods immediately; a valid OCR answer completes the condition',async()=>{
 setLocalEndpoint('http://127.0.0.1:11434/v1',180_000,false);let calls=0
 vi.stubGlobal('fetch',vi.fn((_url,init)=>{if(++calls===2)return Promise.resolve(reply({satisfied:true,id:2}));return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout'))))}))
 const pending=agent({model:'local:gui-owl'}).exists('',{...createNode('condition',0,0),text:'BİTTİ var mı?'})
 await vi.advanceTimersByTimeAsync(180_001);expect(await pending).toBe(true);expect(calls).toBe(2);expect(h.inputs).toEqual([])
})
it('a model error in Click proceeds to the next enabled UIA method and clicks once',async()=>{
 const fetch=vi.fn(async()=>({ok:false,status:503,text:async()=> 'offline'}));vi.stubGlobal('fetch',fetch)
 await agent().click({...createNode('click',0,0),prompt:'“Run” düğmesine tıkla'},1)
 expect(fetch).toHaveBeenCalledTimes(1);expect(h.inputs).toEqual(['direct'])
})
it('after the last visual method misses, the next pass captures a fresh image and clicks only after pointer confirmation',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?{ok:false,status:503,text:async()=> 'offline'}:calls===2?reply({name:'computer_use',arguments:{action:'mouse_move',coordinate:[500,500]}}):reply({decision:'confirm'})))
 const pending=retryClick(agent({findOrder:['tars']}),{...createNode('click',0,0),prompt:'Run'})
 await vi.advanceTimersByTimeAsync(4000);expect(calls,h.logs.join("\n")).toBe(3);await pending
 expect(calls).toBe(3);expect(h.inputs).toEqual(['visual']);expect(h.scans.length).toBeGreaterThanOrEqual(3)
 expect(h.scans[1].fresh).toBe(true)
})

it('a formal visual missing decision returns a recoverable method exhaustion',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({name:'computer_use',arguments:{action:'terminate',status:'failure'}})))
 await expect(agent({findOrder:['tars']}).click({...createNode('click',0,0),prompt:'Run'},1)).rejects.toThrow('ekranda bulunamadı')
 expect(h.inputs).toEqual([])
})
it('an explicit list give_up cannot stop the run without Recovery',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null,give_up:true,text:'Run',reason:'The requested application is closed.'})))
 await expect(agent({findOrder:['list']}).click({...createNode('click',0,0),prompt:'Run'},1)).rejects.toThrow('ekranda bulunamadı')
 expect(h.inputs).toEqual([])
})
it('a method error cannot become give-up just because another method returned missing',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?{ok:false,status:503,text:async()=> 'offline'}:calls===2?reply({name:'computer_use',arguments:{action:'terminate',status:'failure'}}):reply({id:1,text:'Run'})))
 const pending=retryClick(agent({findOrder:['list','tars']}),{...createNode('click',0,0),prompt:'Run'})
 await vi.advanceTimersByTimeAsync(3100);await pending
 expect(calls).toBe(3);expect(h.inputs).toEqual(['direct'])
})
it('another enabled method may find the target after a valid give-up suggestion',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>reply({id:null,give_up:true,reason:'not found'})))
 await agent({findOrder:['list','uia']}).click({...createNode('click',0,0),prompt:'Run'},1)
 expect(h.inputs).toEqual(['direct'])
})
it('an API/key/credit failure in visual targeting cannot be hidden by a later give_up response',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?{ok:false,status:402,text:async()=> 'Insufficient credits'}:calls===2?reply({id:null,give_up:true,reason:'not found'}):calls===3?reply({name:'computer_use',arguments:{action:'mouse_move',coordinate:[500,500]}}):reply({decision:'confirm'})))
 const pending=retryClick(agent({findOrder:['tars','list']}),{...createNode('click',0,0),prompt:'Run'})
 await vi.advanceTimersByTimeAsync(4000);await pending
 expect(calls).toBe(4);expect(h.inputs).toEqual(['visual'])
})
