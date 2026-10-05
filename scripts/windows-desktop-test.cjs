// Real Electron + real PowerShell worker + real visible WPF window.
// The fixture's event log is the independent oracle; a sent command isn't success.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createTargetRecorder } = require('./target-recorder.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.NUBBO_TEST_OUTPUT || 'out/windows-desktop');
const fixtureDir = path.join(output, 'fixture');
const results = [], logs = [];
let host, bridge, commandSeq = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class EnvironmentBlocked extends Error {}
const summary = { status: 'running', scope: 'Real Windows input; live models only if explicitly enabled', results, platform: process.platform };

function state() {
  // File.Replace can briefly lock the destination on Windows. Always read a
  // fresh snapshot; never return a cached state that could falsely pass a case.
  for (let attempt = 0; ; attempt++) {
    try { return JSON.parse(fs.readFileSync(path.join(fixtureDir, 'state.json'), 'utf8')); }
    catch (e) {
      if (e.code === 'EBUSY' && attempt < 5) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      if (e.code === 'ENOENT' || e instanceof SyntaxError) return null;
      throw e;
    }
  }
}
async function until(check, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(100); }
  throw new Error('Timed out: ' + label);
}
async function command(kind, extra = {}) {
  const seq = ++commandSeq;
  const file = path.join(fixtureDir, 'command.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ seq, kind, ...extra }));
  fs.renameSync(tmp, file);
  const s = await until(() => { const s = state(); return s?.commandSeq === seq && s; }, 'fixture command ' + kind);
  if (s.error) throw new Error(s.error);
  return s;
}
const clicks = s => s.events.filter(e => e.kind === 'click');
const mouse = s => s.events.filter(e => e.kind === 'mouse');
const center = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (r, p) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
const node = (id, prompt, extra = {}) => ({ id, kind: 'click', title: id, prompt, ...extra });
// Isolate target + input from the existing screen-transition heuristic. No extra
// node is added to user flows. A separate runGraph test covers the normal runner.
const independentObserver = { next: { id: 'oracle', kind: 'condition', title: 'Independent fixture observer' } };
const allStages = ['chrome','uia','icon','windows','onnx','list','tars','offset'];

function makeAgent(label, stages = ['windows'], extraSettings = {}) {
  const { createAgent } = require('../dist-electron/agent.js');
  const { DEFAULT_SETTINGS } = require('../dist-electron/graph-types.js');
  const events = [], recorder = createTargetRecorder(path.join(output, 'evidence'), label);
  const agent = createAgent({
    log: (level, message) => { logs.push({ at: new Date().toISOString(), case: label, level, message }); if (logs.length > 1000) logs.shift(); },
    send: () => {}, shouldStop: () => false, captureTargetImages: true,
    onTargetTrace: e => { events.push(e); if (events.length > 100) events.shift(); recorder.save(e); },
    settings: () => ({ ...DEFAULT_SETTINGS, apiKey: '', targetWindow: 'Nubbo Click Test Host',
      findOrder: stages, findOff: allStages.filter(s => !stages.includes(s)), ...extraSettings }),
  });
  return { ...agent, events, traces: recorder.files };
}
async function expectClick(agent, n, expected) {
  await command('reset');
  await agent.executor.click(n, 1, independentObserver);
  const s = await until(() => { const s = state(); return clicks(s).length && s; }, 'actual button event ' + expected);
  assert.deepEqual(clicks(s).map(e => e.id), [expected], 'the intended button must be the only button actually activated');
  assert.deepEqual(mouse(s).map(e => e.id), [expected], 'one physical mouse press on the intended button');
  const p = mouse(s)[0].data;
  assert(inside(s.controls[expected].rect, p), 'actual mouse coordinate must be in independent expected bounds');
  const sent = agent.events.filter(e => e.kind === 'input').at(-1);
  assert.equal(sent?.point.x, p.x); assert.equal(sent?.point.y, p.y);
  return s;
}
function writeSummary() {
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, 'agent-log.json'), JSON.stringify(logs, null, 2));
}
async function runCase(name, test) {
  const started = Date.now();
  try { await test(); results.push({ name, status: 'passed', ms: Date.now()-started }); console.log('PASS: ' + name); }
  catch (e) { const blocked = e instanceof EnvironmentBlocked; results.push({ name, status: blocked ? 'environment-blocked' : 'failed', message: e.message, stack: e.stack, ms: Date.now()-started }); console.error((blocked ? 'BLOCKED: ' : 'FAIL: ') + name + ': ' + e.message); }
  writeSummary();
}

app.whenReady().then(async () => {
  let exitCode = 1;
  fs.mkdirSync(fixtureDir, { recursive: true });
  try {
    if (process.platform !== 'win32') throw new EnvironmentBlocked('A real Windows desktop is required');
    // A fresh artifact directory prevents stale fixture state from satisfying a probe.
    for (const f of ['state.json','command.json']) fs.rmSync(path.join(fixtureDir, f), { force: true });
    const exe = path.join(fixtureDir, 'NubboClickTestHost.exe');
    await promisify(execFile)('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows/build-host.ps1'),'-Output',exe], { timeout: 60000 });
    host = spawn(exe, [fixtureDir], { stdio: ['ignore','pipe','pipe'] });
    host.on('error', e => { summary.hostError = e.message; });
    host.stdout.on('data', b => logs.push({ case: 'host', message: String(b) }));
    host.stderr.on('data', b => logs.push({ case: 'host', message: String(b) }));
    const s = await until(() => state(), 'visible fixture window', 30000);
    if (!s.interactive) throw new EnvironmentBlocked('The runner has no accessible interactive input desktop');
    await command('focus-main');
    bridge = require('../dist-electron/a11y-bridge.js');
    const binding = await bridge.inputTarget({ windowTitle: 'Nubbo Click Test Host' });
    const shot = await bridge.scan({ windowTitle: binding.title, image: 'plain', uia: false, ocr: false, readOnly: true });
    if (!shot.image?.data || shot.image.w < 300) throw new EnvironmentBlocked('The desktop capture is empty or too small');
    const bitmap = nativeImage.createFromBuffer(Buffer.from(shot.image.data,'base64')).getBitmap();
    const colors = new Set();
    for (let i=0; i<bitmap.length; i+=4*101) colors.add(bitmap.subarray(i,i+3).toString('hex'));
    if (colors.size < 8) throw new EnvironmentBlocked('The captured desktop appears blank; native GUI tests were not run');
    fs.writeFileSync(path.join(output,'probe.png'), Buffer.from(shot.image.data,'base64'));
    await command('reset');
    const p = center(state().controls.continue.rect);
    await bridge.clickAt(p.x,p.y,'left',binding);
    const probe = await until(() => { const s=state(); return clicks(s).length && s; },'environment probe receives real mouse input');
    assert.deepEqual(clicks(probe).map(e=>e.id),['continue']);
    summary.environment = { electron: process.versions.electron, windows: process.getSystemVersion?.(),
      dpi: probe.dpi, monitors: probe.monitors, hwnd: probe.hwnd, pid: probe.pid, appPath: app.getAppPath(), nativeInputProbePassed: true };
    // Independent provider evidence separates fixture accessibility problems
    // from production locator/focus bugs. Inspection never sends UI input.
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
        path.join(__dirname,'windows/inspect-host.ps1'),'-WindowHandle',probe.hwnd,'-TargetProcess',String(probe.pid),
        '-Output',path.join(output,'uia-provider-observation.json')], { timeout: 20000 });
    } catch (e) { throw new EnvironmentBlocked('Independent UIA inspection failed: '+e.message); }
    const provider = JSON.parse(fs.readFileSync(path.join(output,'uia-provider-observation.json'),'utf8').replace(/^\uFEFF/,''));
    const rows = provider.rows;
    const button = rows.find(r=>r.name==='Devam' && r.type==='ControlType.Button' && r.enabled);
    const edit = rows.find(r=>r.name==='Kaynak klasör' && r.type==='ControlType.Edit' && r.focusable && r.patterns.includes('ValuePatternIdentifiers.Pattern'));
    const disabled = rows.find(r=>r.name==='Pasif' && r.type==='ControlType.Button' && r.enabled===false);
    if(!button || !edit || !disabled) throw new EnvironmentBlocked('Fixture must expose genuine Button/Edit/ValuePattern providers before targeting assertions');
    summary.environment.fixtureProvidersVerified=true;
    writeSummary();
    if(process.env.NUBBO_PROBE_ONLY==='1') {
      summary.status='probe-passed';
      summary.scope='Environment probe only: visible capture and one native input event. Target-selection tests have not run.';
      summary.notCovered=['Target selection accuracy','Typing and focus','Windows/ONNX OCR recognition','Live models'];
      exitCode=0;
      return;
    }

    await runCase('UIA saved locator activates the actual button', async () => {
      const a=makeAgent('uia',['uia']);
      await expectClick(a,node('uia','“Devam”',{ locator:{ controlType:'Button',name:'Devam',windowTitle:'Nubbo Click Test Host' } }),'continue');
      assert.equal(a.events.find(e=>e.kind==='resolved').source,'uia');
    });
    await runCase('Fresh scan selects a unique actual control', async () => {
      const a=makeAgent('fresh-scan'); await expectClick(a,node('unique','“Devam”'),'continue');
    });
    await runCase('Duplicate captions use the recorded anchor', async () => {
      const anchor=center(state().controls['save-right'].rect);
      const a=makeAgent('duplicate'); await expectClick(a,node('right-save','“Kaydet”',{anchor}),'save-right');
    });
    await runCase('Moved window uses fresh physical coordinates', async () => {
      const b=state().rect; await command('move',{x:180,y:95,w:b.w,h:b.h});
      const a=makeAgent('moved'); await expectClick(a,node('moved','“Devam”'),'continue');
    });
    await runCase('Resized window still hits the real control', async () => {
      await command('move',{w:840,h:620});
      const a=makeAgent('resized'); await expectClick(a,node('resize','“Devam”'),'continue');
    });
    for(const percent of [125,150]) await runCase(`Scaled control layout ${percent}% (not an OS DPI change)`,async()=>{
      await command('layout',{percent}); const a=makeAgent('layout-'+percent); await expectClick(a,node('layout','“Devam”'),'continue');
    });
    await command('layout',{percent:100});
    await runCase('Inactive target window is selected without clicking the other app',async()=>{
      await command('focus-other'); const a=makeAgent('inactive',['uia']);
      await expectClick(a,node('inactive','“Devam”',{locator:{controlType:'Button',name:'Devam',windowTitle:'Nubbo Click Test Host'}}),'continue');
    });
    await runCase('Read-only preview leaves the foreground and input unchanged',async()=>{
      await command('focus-other'); await command('reset'); const before=state();
      const a=makeAgent('preview-uia',['uia']);
      const p=await a.previewTarget(node('preview','“Devam”',{locator:{controlType:'Button',name:'Devam',windowTitle:'Nubbo Click Test Host'}}));
      await sleep(300); const after=state(); assert(inside(after.controls.continue.rect,p));
      assert.equal(after.foreground,before.foreground); assert.equal(after.eventSeq,before.eventSeq);
      assert(!a.events.some(e=>e.kind==='input'));
    });
    await runCase('Read-only scan leaves the foreground unchanged',async()=>{
      await command('focus-other'); const before=state(); const a=makeAgent('preview-scan');
      const p=await a.previewTarget(node('preview-scan','“Devam”'));
      await sleep(200); assert.equal(state().foreground,before.foreground); assert(inside(state().controls.continue.rect,p));
    });
    await runCase('Disabled UIA control is rejected without any input',async()=>{
      await command('focus-main'); await command('reset'); const seq=state().eventSeq;
      const a=makeAgent('disabled',['uia']);
      await assert.rejects(a.previewTarget(node('disabled','“Pasif”',{locator:{controlType:'Button',name:'Pasif',windowTitle:'Nubbo Click Test Host'}})),/bulunamadı/);
      await sleep(200); assert.equal(state().eventSeq,seq);
    });
    await runCase('Click label then type writes only the intended field',async()=>{
      const a=makeAgent('label-field',['uia']); await command('reset');
      const type={id:'write-source',kind:'type',title:'Write source',text:'C:\\Nubbo Test\\Images',clearFirst:true,pressEnter:false};
      const before=state().controls.search.text;
      await a.executor.click(node('source-label','“Kaynak klasör”',{locator:{controlType:'Text',name:'Kaynak klasör',windowTitle:'Nubbo Click Test Host'}}),1,{next:type});
      await a.executor.type(type,2);
      const s=await until(()=>{const s=state(); return s.controls.source.text===type.text && s;},'exact source value');
      assert.equal(s.controls.search.text,before); assert(!s.events.some(e=>e.kind==='text'&&e.id==='search'));
    });
    await runCase('Enter is received exactly once after verified typing',async()=>{
      const a=makeAgent('single-enter',['uia']); await command('reset');
      const type={id:'enter-source',kind:'type',title:'Write then Enter',text:'C:\\Nubbo Test\\OneEnter',clearFirst:true,pressEnter:true};
      await a.executor.click(node('source-edit','“Kaynak klasör”',{locator:{controlType:'Edit',name:'Kaynak klasör',windowTitle:'Nubbo Click Test Host'}}),1,{next:type});
      await a.executor.type(type,2,independentObserver);
      const s=await until(()=>{const s=state();return s.events.some(e=>e.kind==='key'&&e.data.key==='Enter')&&s;},'Enter key event');
      await sleep(300); assert.equal(state().events.filter(e=>e.kind==='key'&&e.data.key==='Enter').length,1);
      assert.equal(s.controls.source.text,type.text);
    });
    await runCase('Occluded bound click is refused by the real native guard',async()=>{
      await command('focus-main'); const target=await bridge.inputTarget({windowTitle:'Nubbo Click Test Host'});
      const p=center(state().controls.continue.rect); await command('cover'); await command('reset');
      try { await assert.rejects(bridge.clickAt(p.x,p.y,'left',target),/INPUT_WINDOW_NOT_ACTIVE|INPUT_CLICK_OCCLUDED/); assert.equal(state().events.length,0); }
      finally { await command('uncover'); await command('focus-main'); }
    });
    await runCase('Repeated node executions produce one correct click each',async()=>{
      const a=makeAgent('repeat',['uia']);
      for(let i=0;i<12;i++) await expectClick(a,node('repeat','“Devam”',{locator:{controlType:'Button',name:'Devam',windowTitle:'Nubbo Click Test Host'}}),'continue');
    });
    await runCase('Real Windows OCR clicks painted text with no UIA caption',async()=>{
      await command('focus-main');
      const scan=await bridge.scan({windowTitle:'Nubbo Click Test Host',image:'plain',uia:false,ocr:true,ocrEngine:'windows',deferOnnx:true});
      bridge.discardShot(scan.shot);
      if(!scan.ocr) throw new EnvironmentBlocked('Windows OCR is unavailable on this runner; OCR accuracy was not measured');
      const a=makeAgent('painted-ocr'); await command('reset');
      await a.executor.click(node('painted','“RUN REMESH”'),1,independentObserver);
      const s=await until(()=>{const s=state();return mouse(s).length && s;},'painted control real mouse event');
      assert.deepEqual(mouse(s).map(e=>e.id),['painted-remesh']);
      assert.equal(a.events.find(e=>e.kind==='resolved').item.src,'ocr');
      assert(inside(s.controls['painted-remesh'].rect,mouse(s)[0].data));
    });
    if(process.env.NUBBO_TEST_ONNX==='1') await runCase('Bundled ONNX recognizes painted text and the production fallback clicks it',async()=>{
      const onnx=await bridge.scan({windowTitle:'Nubbo Click Test Host',image:'plain',uia:false,ocr:true,ocrEngine:'onnx'});
      // Keep the actual recognized rows even when the recognition assertion fails.
      fs.writeFileSync(path.join(output,'onnx-observation.json'),JSON.stringify({...onnx,image:onnx.image?{w:onnx.image.w,h:onnx.image.h,mime:onnx.image.mime}:null},null,2));
      assert.equal(onnx.onnx,true,'the actual bundled ONNX engine must produce accepted text');
      assert.equal(onnx.ocrEngine,'onnx');
      const {matchText}=require('../dist-electron/matcher.js');
      const read=matchText(onnx.items,'RUN REMESH',{minScore:100});
      assert(read,'the ONNX scan must read the painted caption'); assert(inside(state().controls['painted-remesh'].rect,center(read)));
      const a=makeAgent('painted-onnx',['onnx']); await command('reset');
      await a.executor.click(node('onnx-painted','“RUN REMESH”'),1,independentObserver);
      const s=await until(()=>{const s=state();return mouse(s).length && s;},'ONNX target mouse event');
      assert.deepEqual(mouse(s).map(e=>e.id),['painted-remesh']);
      assert.equal(a.events.find(e=>e.kind==='resolved').source,'onnx');
    });
    await runCase('Production graph runner completes a real click flow',async()=>{
      const { runGraph }=require('../dist-electron/runner.js'); const a=makeAgent('runner',['uia']); await command('reset');
      const start={id:'start',kind:'start',title:'Start'}, end={id:'end',kind:'end',title:'End'};
      const click=node('graph-click','“Devam”',{locator:{controlType:'Button',name:'Devam',windowTitle:'Nubbo Click Test Host'}});
      const graph={id:'desktop-test',name:'Desktop test',nodes:[start,click,end],edges:[{id:'one',from:'start',to:click.id,fromPort:'next'},{id:'two',from:click.id,to:'end',fromPort:'next'}]};
      const result=await runGraph(graph,a.executor,{maxSteps:10,stepDelayMs:0});
      assert.equal(result.failed,0); assert.deepEqual(clicks(state()).map(e=>e.id),['continue']);
    });

    // Coverage limits are explicit and never counted as successful tests.
    summary.notCovered=['Actual OS DPI changes to 125/150% (only control layout was scaled)',
      'Multiple monitors / negative monitor origin on a single-monitor runner', 'Real Blender addon UI',
      'Hours-long operation', 'Chrome profile switching and Hunyuan', 'OS Win shortcut effects'];
    if(process.env.NUBBO_TEST_ONNX!=='1') summary.notCovered.push('Bundled ONNX recognition (deferred; opt in with NUBBO_TEST_ONNX=1)');
    if(process.env.NUBBO_RUN_LIVE_MODELS==='1') {
      if(!process.env.NUBBO_TEST_API_KEY) results.push({name:'Live models',status:'environment-blocked',message:'NUBBO_TEST_API_KEY is missing; no live model request sent'});
      else {
        for(const stage of ['list','tars']) await runCase('Live model target selection: '+stage,async()=>{
          const model=stage==='list'?process.env.NUBBO_TEST_TEXT_MODEL:process.env.NUBBO_TEST_GUI_MODEL;
          if(!model) throw new EnvironmentBlocked('Specify the model explicitly before a paid live test');
          const a=makeAgent('live-'+stage,[stage],{apiKey:process.env.NUBBO_TEST_API_KEY,model,agentModel:model,sendScreenshot:false});
          await expectClick(a,node('live-'+stage,'Click the button labeled Devam. Do nothing else.'),'continue');
        });
      }
    } else summary.notCovered.push('Live LLM/UI-TARS accuracy; no model API calls made');
    summary.counts={passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,blocked:results.filter(r=>r.status==='environment-blocked').length};
    summary.status=summary.counts.failed?'failed':summary.counts.blocked?'environment-blocked':'passed';
    exitCode=summary.counts.failed?1:summary.counts.blocked?2:0;
  } catch(e) {
    summary.status=e instanceof EnvironmentBlocked?'environment-blocked':'failed'; summary.error=e.stack; exitCode=e instanceof EnvironmentBlocked?2:1;
    console.error(summary.status+': '+e.stack);
  } finally {
    writeSummary();
    bridge?.shutdown();
    if(host && host.exitCode===null) { try { await command('close'); } catch {} host.kill(); }
    console.log('Desktop evidence: '+output);
    app.exit(exitCode);
  }
});
