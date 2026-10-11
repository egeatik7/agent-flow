import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { pruneScreenFiles, writeScreenFile } from '../electron/screen-files'
import { profileDirName } from '../electron/profile'
import { createNode, DEFAULT_SETTINGS, normalizeGraph } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'
import { runModelChain, ModelFailed, setStopCheck, chooseTypeField, setChatLogger } from '../electron/openrouter'
const require=createRequire(import.meta.url)
const {profileDirName:cliProfile}=require('../scripts/profile-name.cjs')
const {assertScenarioFile}=require('../scripts/scenario-files.cjs')
const dirs:string[]=[]
function temp(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nubbo-regression-'));dirs.push(dir);return dir}
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});vi.useRealTimers();vi.unstubAllGlobals();setStopCheck(()=>false);setChatLogger(null)})
it('C2: screenshots retain the delivered image with bounded count, age, and owned filenames only',()=>{
 const dir=temp(),now=Date.now()
 for(let i=0;i<105;i++)fs.writeFileSync(path.join(dir,`nubbo-screen-2026-10-11T00-00-00-${i}.png`),'x')
 const other=path.join(dir,'other.png');fs.writeFileSync(other,'keep')
 const old=path.join(dir,'nubbo-screen-2020-01-01T00-00-00.png');fs.writeFileSync(old,'x');fs.utimesSync(old,new Date(now-48*60*60_000),new Date(now-48*60*60_000))
 const current=writeScreenFile('AA==','image/png',dir)
 expect(fs.existsSync(current)).toBe(true);expect(fs.existsSync(old)).toBe(false);expect(fs.existsSync(other)).toBe(true)
 expect(fs.readdirSync(dir).filter(n=>n.startsWith('nubbo-screen-'))).toHaveLength(100)
})
it('C2: screenshot byte bound removes older large files and does not follow symlinks',()=>{
 const dir=temp(),target=path.join(dir,'important.txt');fs.writeFileSync(target,'keep')
 const large=path.join(dir,'nubbo-screen-2026-10-11T00-00-00.png');const fd=fs.openSync(large,'w');fs.ftruncateSync(fd,101*1024*1024);fs.closeSync(fd)
 const link=path.join(dir,'nubbo-screen-2026-10-11T00-00-01.png');fs.symlinkSync(target,link)
 pruneScreenFiles(dir);expect(fs.existsSync(large)).toBe(false);expect(fs.existsSync(link)).toBe(true);expect(fs.readFileSync(target,'utf8')).toBe('keep')
})
it('E3: application and every CLI share profile normalization including invalid names',()=>{
 for(const input of [undefined,'','test','Test_one','---','ç','  Foo-Bar  '])expect(cliProfile(input)).toBe(profileDirName(input))
})
it('E4: expected-file cleanup rejects paths outside the approved root and symlink escapes',()=>{
 const dir=temp(),allowed=path.join(dir,'scenario'),outside=path.join(dir,'Documents');fs.mkdirSync(allowed);fs.mkdirSync(outside)
 const userFile=path.join(outside,'important.txt');fs.writeFileSync(userFile,'keep')
 expect(()=>assertScenarioFile(userFile,[allowed])).toThrow('dışında')
 expect(()=>assertScenarioFile(path.join(allowed,'..','Documents','important.txt'),[allowed])).toThrow('dışında')
 const link=path.join(allowed,'escape');fs.symlinkSync(outside,link,'dir')
 expect(()=>assertScenarioFile(path.join(link,'important.txt'),[allowed])).toThrow('sembolik')
 expect(assertScenarioFile(path.join(allowed,'new.txt'),[allowed])).toBe(path.join(allowed,'new.txt'))
 expect(fs.readFileSync(userFile,'utf8')).toBe('keep')
})
function idle(output:string|Error){
 let exit=-1;const logs:string[]=[]
 const code=fs.readFileSync(new URL('../scripts/dev-idle.cjs',import.meta.url),'utf8')
 vm.runInNewContext(code,{require:()=>({execFileSync:()=>{if(output instanceof Error)throw output;return output}}),process:{argv:['node','idle','--json'],exit:(n:number)=>{exit=n}},console:{log:(s:string)=>logs.push(s)}})
 return {exit,result:JSON.parse(logs.join(''))}
}
it('E5: unknown, empty or failed idle measurement blocks desktop automation',()=>{
 for(const out of ['not a number','',new Error('powershell failed'),'-1']){
  const r=idle(out);expect(r.exit).toBe(4);expect(r.result.free).toBe(false)
 }
 expect(idle('65000').result.free).toBe(true);expect(idle('100').result.free).toBe(false)
})
it('E1: test-start cleanup reaches the temp rule with its actual os import',()=>{
 const source=fs.readFileSync(new URL('../scripts/dev-start-test.cjs',import.meta.url),'utf8')
 const from=source.indexOf('function portableTempSupur()'),to=source.indexOf('/** Bir klasör',from)
 const removed:string[]=[]
 const code=source.match(/const os = require\('os'\)/)![0]+';'+source.slice(from,to)+';portableTempSupur()'
 vm.runInNewContext(code,{require:(name:string)=>name==='os'?{tmpdir:()=>'/TEMP'}:{geciciGirdileriTopla:()=>[],bayatCikarmaKlasorleri:()=>[{yol:'/TEMP/owned'}]},root:'/repo',exe:'/exe/Nubbo.exe',path,fs:{readdirSync:()=>['owned'],statSync:()=>({isDirectory:()=>true}),rmSync:(p:string)=>removed.push(p)},boyutMB:()=>1,console:{log:()=>{}}})
 expect(removed).toEqual(['/TEMP/owned'])
})
it('E2/E3: dev-status accepts same-sha dirty stamp and reads a custom isolated profile',()=>{
 const source=fs.readFileSync(new URL('../scripts/dev-status.cjs',import.meta.url),'utf8')
 const paths:string[]=[],logs:string[]=[]
 const filesystem={existsSync:(p:string)=>{paths.push(p);return p.endsWith('tool-endpoint.json')},readFileSync:()=>JSON.stringify({pid:123,build:'abc-dirty'})}
 vm.runInNewContext(source,{__dirname:'/repo/scripts',process:{argv:['node','status','Test_one'],env:{APPDATA:'/profiles'},kill:()=>{}},console:{log:(s:string)=>logs.push(s)},require:(name:string)=>name==='./profile-name.cjs'?{profileDirName:cliProfile}:name==='fs'?filesystem:name==='path'?path:{execFileSync:(cmd:string,args:string[])=>cmd==='git'?args.includes('--short')?'abc':args.includes('--porcelain')?'modified':'' : JSON.stringify({idleMs:70000})}})
 expect(paths).toContain(path.join('/profiles','xp-agent-studio-testone','tool-endpoint.json'))
 expect(logs.join(' ')).not.toContain('eski build olabilir')
})
it('A5: 60 legitimate loop items are unaffected by a small top-level budget',async()=>{
 const start=createNode('start',0,0),loop=createNode('loop',0,0),click=createNode('click',0,0),end=createNode('end',0,0)
 loop.items=Array.from({length:60},(_,i)=>String(i));loop.members=[click.id]
 const execute=vi.fn(async()=>{});const ex:Executor={log:()=>{},step:()=>{},shouldStop:()=>false,click:execute,type:async()=>{},key:async()=>{},exists:async()=>false}
 const result=await runGraph({nodes:[start,loop,click,end],edges:[{id:'a',from:start.id,fromPort:'next',to:loop.id},{id:'b',from:loop.id,fromPort:'done',to:end.id}]},ex,{maxSteps:3,stepDelayMs:0,reportEnd:true})
 expect(result.failed).toBe(0);expect(result.reachedEnd).toBe(true);expect(execute).toHaveBeenCalledTimes(60)
})
it('A3: tagged infrastructure error stops on the current item while target-dependent misses remain skippable',async()=>{
 const start=createNode('start',0,0),loop=createNode('loop',0,0),click=createNode('click',0,0)
 loop.items=['a','b','c'];loop.members=[click.id];click.prompt='{{öğe}}'
 const execute=vi.fn(async n=>{throw new ModelFailed(`local failure for “${n.prompt}”`)})
 const ex:Executor={log:()=>{},step:()=>{},shouldStop:()=>false,click:execute,type:async()=>{},key:async()=>{},exists:async()=>false}
 await expect(runGraph({nodes:[start,loop,click],edges:[{id:'a',from:start.id,fromPort:'next',to:loop.id}]},ex,{maxSteps:3,stepDelayMs:0})).rejects.toThrow('local failure')
 expect(execute).toHaveBeenCalledTimes(1);expect(loop.startIndex).toBe(0)
})
it('A1: total wait bound stops transient retry even when permanent-rejection count resets',async()=>{
 vi.useFakeTimers();const run=vi.fn(async()=>{throw new ModelFailed('outage')})
 const pending=runModelChain(['a'],run,1000,{maxWaitMs:2500});const assertion=expect(pending).rejects.toThrow(/süresi|sınırı/)
 await vi.runAllTimersAsync();await assertion;expect(run).toHaveBeenCalledTimes(3)
})
it.each([413,415,500])('A1: HTTP %i permanent payload/OOM failures are bounded',async status=>{
 vi.useFakeTimers();const fetch=vi.fn(async()=>({ok:false,status,text:async()=>status===500?'out of memory':'payload rejected'}));vi.stubGlobal('fetch',fetch)
 const pending=chooseTypeField({apiKey:'key',model:'model',step:'type',instruction:'',text:'x',ahead:'',choices:[]})
 const assertion=expect(pending).rejects.toThrow('8 tur üst üste');await vi.runAllTimersAsync();await assertion;expect(fetch).toHaveBeenCalledTimes(8)
})
it('C1: provider error echo of a valid API key is masked in errors and logs',async()=>{
 vi.useFakeTimers();const logs:string[]=[];setChatLogger(s=>logs.push(s));const key='synthetic-key-private'
 vi.stubGlobal('fetch',async()=>({ok:true,status:200,text:async()=>JSON.stringify({error:`invalid request ${key}`})}))
 const pending=chooseTypeField({apiKey:key,model:'model',step:'type',instruction:'',text:'x',ahead:'',choices:[]}).catch((e:Error)=>e.message)
 await vi.runAllTimersAsync();expect(await pending).not.toContain(key);expect(logs.join(' ')).not.toContain(key)
})
it('C3: normalized custom JSON coordinates require explicit declaration',async()=>{
 const {parseJsonAction}=await import('../electron/openrouter')
 expect(parseJsonAction('{"action":"click","x":1,"y":0.5,"coordinate_unit":"normalized"}')).toMatchObject({x:1,y:.5})
 expect(()=>parseJsonAction('{"action":"click","x":500,"y":1,"coordinate_unit":"normalized"}')).toThrow('0–1')
})
it('D6: actual settings loader preserves a deliberate maxSteps=500',()=>{
 const source=fs.readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8'),from=source.indexOf('function getSettings()'),to=source.indexOf('/** True while',from)
 const js=ts.transpileModule(source.slice(from,to)+'return getSettings();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const ctx={DEFAULT_SETTINGS,store:{get:()=>({maxSteps:500})},setLocalEndpoint:()=>{},clampRamp:()=>({lo:0,hi:1}),bridge:{setValueRamp:()=>{},setOcrEngine:()=>{}},normalizeFind:()=>({order:[],off:[]}),DEFAULT_FIND_OFF:[],normalizePrompts:(p:unknown)=>p,cleanBackups:(p:unknown)=>p,recoverySettings:(p:unknown)=>p}
 expect(new Function('ctx','with(ctx){'+js+'}')(ctx).maxSteps).toBe(500)
})
it('Q7: legacy graph IPC writes normalized data, not raw unsupported nodes',()=>{
 const source=fs.readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8'),from=source.indexOf("  ipcMain.handle('graph:save'"),to=source.indexOf('\n  // Developer/test',from)
 const js=ts.transpileModule(source.slice(from,to),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 let handler:any;const store={set:vi.fn()};new Function('ctx','with(ctx){'+js+'}')({ipcMain:{handle:(_name:string,h:any)=>handler=h},store,normalizeGraph})
 const raw={nodes:[],edges:[]};expect(handler({},raw)).toBe(true);expect(store.set).toHaveBeenCalledWith('graph',expect.objectContaining({nodes:[expect.objectContaining({kind:'start'})],edges:[]}));expect(store.set.mock.calls[0][1]).not.toBe(raw)
})

it.each([false,true])('Q6: debug reaches nested package loops (manual package path=%s)',async manual=>{
 const start=createNode('start',0,0),loop=createNode('loop',0,0),click=createNode('click',0,0),pkg=createNode('package',0,0)
 loop.items=['a','b'];loop.members=[click.id];click.prompt='{{öğe}}'
 pkg.inner={nodes:[start,loop,click],edges:[{id:'a',from:start.id,fromPort:'next',to:loop.id},{id:'self',from:loop.id,fromPort:'done',to:loop.id}]}
 const execute=vi.fn(async n=>{throw new Error(`missing: ${n.prompt}`)})
 const ex:Executor={log:()=>{},step:()=>{},shouldStop:()=>false,click:execute,type:async()=>{},key:async()=>{},exists:async()=>false}
 await expect(runGraph({nodes:[pkg],edges:[]},ex,{maxSteps:50,stepDelayMs:0,debug:true,...(manual?{packagePath:[pkg.id]}:{})})).rejects.toThrow('aynı hata kümesi')
 expect(execute).toHaveBeenCalledTimes(4)
})
