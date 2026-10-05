// Runs against an unmodified checkout of main. Only this test and its visible
// fixture are copied into that checkout; no production source is overlaid.
const {app}=require('electron');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const root=__dirname, output=path.join(root,'out','main-desktop'), fixture=path.join(output,'fixture');
const results=[], logs=[]; let seq=0,host,bridge;
const report={scope:'Exact main checkout; native event oracle; no production overlays',revision:process.env.NUBBO_MAIN_SHA,results};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function state(){try{return JSON.parse(fs.readFileSync(path.join(fixture,'state.json'),'utf8'));}catch(e){if(['ENOENT','EBUSY'].includes(e.code)||e instanceof SyntaxError)return null;throw e;}}
async function until(fn,label){const end=Date.now()+8000;while(Date.now()<end){const v=fn();if(v)return v;await sleep(100);}throw Error('Timed out: '+label);}
async function command(kind){const n=++seq;fs.writeFileSync(path.join(fixture,'command.json'),JSON.stringify({seq:n,kind}));const s=await until(()=>{const s=state();return s?.commandSeq===n&&s;},kind);assert.equal(s.error,'');return s;}
function agent(stages){const {createAgent}=require('./dist-electron/agent.js'),{DEFAULT_SETTINGS}=require('./dist-electron/graph-types.js');return createAgent({log:(level,message)=>logs.push({level,message}),send:()=>{},shouldStop:()=>false,settings:()=>({...DEFAULT_SETTINGS,apiKey:'',targetWindow:'Nubbo Click Test Host',findOrder:stages,findOff:['chrome','uia','icon','windows','onnx','list','tars','offset'].filter(s=>!stages.includes(s))})});}
const ahead={next:{id:'oracle',kind:'condition',title:'Independent event oracle'}};
const click=(name,type)=>({id:'click',kind:'click',title:'Click',prompt:'“'+name+'”',...(type?{locator:{controlType:type,name,windowTitle:'Nubbo Click Test Host'}}:{})});
async function test(name,fn){try{await command('focus-main');await command('reset');await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.stack});}console.log(JSON.stringify(results.at(-1)));}
async function actualClick(a,n,id){await a.executor.click(n,1,ahead);const s=await until(()=>{const s=state();return s.events.some(e=>e.kind==='click')&&s;},id);assert.deepEqual(s.events.filter(e=>e.kind==='click').map(e=>e.id),[id]);assert.deepEqual(s.events.filter(e=>e.kind==='mouse').map(e=>e.id),[id]);}
app.whenReady().then(async()=>{
 let exit=1;
 try{
  assert.equal(process.platform,'win32');fs.mkdirSync(fixture,{recursive:true});
  const exe=path.join(fixture,'Host.exe');await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/windows/build-host.ps1'),'-Output',exe]);
  host=spawn(exe,[fixture]);host.on('error',e=>{report.hostError=e.message;});await until(()=>state(),'visible main fixture');
  assert(state().interactive,'actual input desktop required');bridge=require('./dist-electron/a11y-bridge.js');
  await test('Main UIA click uses real button event',()=>actualClick(agent(['uia']),click('Devam','Button'),'continue'));
  await test('Main fresh Windows scan clicks actual control',()=>actualClick(agent(['windows']),click('Devam'),'continue'));
  await test('Main inactive-window click selects correct app',async()=>{await command('focus-other');await actualClick(agent(['uia']),click('Devam','Button'),'continue');});
  await test('Main type reads back intended field and sends one Enter',async()=>{
   const a=agent(['uia']), before=state().controls.search.text;
   const t={id:'type',kind:'type',title:'Type',text:'C:\\Nubbo Main\\Images',clearFirst:true,pressEnter:true};
   await a.executor.click(click('Kaynak klasör','Edit'),1,{next:t});await a.executor.type(t,2,ahead);
   await until(()=>state().events.some(e=>e.kind==='key'&&e.data.key==='Enter'),'actual Enter');await sleep(300);
   const s=state();assert.equal(s.controls.source.text,t.text);assert.equal(s.controls.search.text,before);
   assert.equal(s.events.filter(e=>e.kind==='key'&&e.data.key==='Enter').length,1);
  });
  await test('Main Windows OCR clicks custom painted text',async()=>{
   await agent(['windows']).executor.click(click('RUN REMESH'),1,ahead);
   const s=await until(()=>{const s=state();return s.events.some(e=>e.kind==='mouse')&&s;},'OCR mouse event');
   assert.deepEqual(s.events.filter(e=>e.kind==='mouse').map(e=>e.id),['painted-remesh']);
  });
  report.status=results.every(x=>x.status==='passed')?'passed':'failed';exit=report.status==='passed'?0:1;
 }catch(e){report.status='failed';report.error=e.stack;}finally{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'log.json'),JSON.stringify(logs,null,2));
  bridge?.shutdown();if(host){try{await command('close');}catch{}host.kill();}app.exit(exit);
 }
});
