const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replayTrace } = require('./replay-target.cjs');
const { createTargetRecorder, loadTrace } = require('./target-recorder.cjs');
const all = ['chrome','uia','icon','windows','onnx','list','tars','offset'];
const item = (id,text,x,y,w=100,h=30) => ({id,text,x,y,w,h,src:'ocr',type:'Text'});
function bundle(order, items, extra={}) {
  const area=extra.area || {x:0,y:0,w:1920,h:1080};
  const scan={area,items,ocr:true,uiaCount:0,ocrCount:items.length,image:null,window:'Fixture'};
  return {version:1,events:[
    {version:1,kind:'request',nodeId:'test',node:{id:'test',kind:'click',title:'Test',prompt:'“Kaydet”',...extra.node},order,readOnly:false,windowTitle:'Fixture',modelEnabled:!!extra.model,memory:extra.memory},
    {version:1,kind:'observation',nodeId:'test',source:'windows',scan},
    ...(extra.events || []),
  ]};
}
test('same-caption replay chooses the recorded nearby target, not the first OCR row',async()=>{
  const b=bundle(['windows'],[item(1,'Kaydet',20,50),item(2,'Kaydet',600,50)],{node:{anchor:{x:650,y:65}}});
  const r=await replayTrace(b); assert.deepEqual({x:r.result.x,y:r.result.y},{x:650,y:65}); assert.equal(r.inputCalls,0);
});
test('fresh candidate IDs/order do not reuse an old list index',async()=>{
  for(const items of [[item(9,'Kaydet',600,50),item(1,'Kaydet',20,50)],[item(70,'Kaydet',20,50),item(3,'Kaydet',600,50)]]) {
    const r=await replayTrace(bundle(['windows'],items,{node:{anchor:{x:650,y:65}}})); assert.equal(r.result.x,650);
  }
});
test('negative desktop origin stays in the actual screen coordinate space',async()=>{
  const r=await replayTrace(bundle(['windows'],[item(1,'Kaydet',-1750,120)],{area:{x:-1920,y:0,w:1920,h:1080}}));
  assert.equal(r.result.x,-1700); assert.equal(r.result.y,135);
});
test('a recorded list choice refines the click region inside a merged OCR line',async()=>{
  const row=item(1,'İptal Kaydet',100,50,300,30); row.words=[{t:'İptal',x:100,y:50,w:90,h:30},{t:'Kaydet',x:290,y:50,w:80,h:30}];
  const b=bundle(['list'],[row],{model:true,node:{prompt:'Click save inside this row'},events:[{kind:'model',source:'list',value:{id:1,text:'Kaydet'}}]});
  const r=await replayTrace(b); assert.equal(r.result.x,330);
});
test('ONNX fallback uses its own fresh boxes without sending input',async()=>{
  const b=bundle(['windows','onnx'],[item(1,'İptal',10,10)],{events:[{kind:'observation',source:'onnx',scan:{area:{x:0,y:0,w:1920,h:1080},items:[item(4,'Kaydet',500,300)],image:null,window:'Fixture'}}]});
  const r=await replayTrace(b); assert.equal(r.result.x,550); assert.equal(r.inputCalls,0);
});
test('a recorded model answer choosing an absent candidate never produces a target',async()=>{
  const b=bundle(['list'],[item(1,'Kaydet',100,100)],{model:true,node:{prompt:'Choose save'},events:[{kind:'model',source:'list',value:{id:99,reason:'wrong ID'}}]});
  await assert.rejects(replayTrace(b),/bulunamadı/);
});
test('recorded model choice is reproduced through the production list resolver',async()=>{
  const b=bundle(['list'],[item(1,'Kaydet',20,50),item(2,'Kaydet',600,50)],{model:true,node:{prompt:'Click right save'},events:[{kind:'model',source:'list',value:{id:2,reason:'right'}}]});
  const r=await replayTrace(b); assert.equal(r.result.x,650); assert.equal(r.modelAnswersReplayed,true);
});
test('TARS replay converts normalized screenshot coordinates using independent X/Y scaling',async()=>{
  for(const scale of [1,1.25,1.5]) {
    const b=bundle(['tars'],[],{model:true,node:{prompt:'Click save'},events:[
      {kind:'observation',source:'tars',scan:{area:{x:-1920*scale,y:100,w:1920*scale,h:1080*scale},image:{data:'fixture',w:1288,h:728},items:[],window:'Fixture'}},
      {kind:'model',source:'tars',value:{kind:'click',x:.75,y:.25,thought:'Recorded answer',raw:'click()'}},
    ]});
    const r=await replayTrace(b); assert.equal(r.result.x,-480*scale); assert.equal(r.result.y,100+270*scale); assert.equal(r.inputCalls,0);
  }
});
test('preview rejects disabled UIA target without falling through to other stages',async()=>{
  const b=bundle(['uia'],[],{node:{locator:{controlType:'Button',name:'Kaydet',windowTitle:'Fixture'}},events:[{kind:'observation',source:'uia',value:{x:10,y:10,w:100,h:30,name:'Kaydet',enabled:false}}]});
  await assert.rejects(replayTrace(b),/bulunamadı/);
});
test('observer mutations and recorder errors cannot change the production selection',async()=>{
  const b=bundle(['windows'],[item(1,'Kaydet',100,50)]);
  const r=await replayTrace(b,e=>{if(e.scan) e.scan.items.length=0; if(e.kind==='resolved') e.target.x=9999; throw new Error('Recorder unavailable');});
  assert.equal(r.result.x,150); assert.equal(r.inputCalls,0);
});
test('recording images does not add them to the model input',async()=>{
  // Diagnostic PNG is available to the recorder, but the actual list path used image:none.
  const b=bundle(['windows'],[item(1,'Kaydet',100,50)]);
  b.events[1].scan.image={data:'diagnostic-only',w:1920,h:1080,mime:'image/png'};
  const seen=[]; await replayTrace(b,e=>seen.push(e));
  assert.equal(seen.find(e=>e.kind==='observation').scan.image,null);
});
test('trace files can reproduce selection; retention and overlay respect screenshot origin',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nubbo-target-'));
  try {
    const recorder=createTargetRecorder(dir,'test',2);
    for(let i=0;i<4;i++) {
      const b=bundle(['windows'],[item(1,'Kaydet',-1750,120)],{area:{x:-1920,y:0,w:1920,h:1080}});
      b.events[1].scan.image={data:Buffer.from('diagnostic').toString('base64'),w:960,h:540,mime:'image/png'};
      for(const e of b.events) recorder.save(e);
      const r=await replayTrace(b); recorder.save({kind:'resolved',source:'windows',target:r.result,rect:b.events[1].scan.items[0]});
    }
    assert.equal(recorder.files().length,2); assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.trace.json')).length,2);
    const file=recorder.files().at(-1); const loaded=loadTrace(file); const r=await replayTrace(loaded); assert.equal(r.result.x,-1700);
    const svg=fs.readFileSync(file.replace('.trace.json','.overlay.svg'),'utf8'); assert(svg.includes('cx="110"')); assert(svg.includes('cy="67.5"'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('incomplete recordings are reported, rather than inventing OS observations',async()=>{
  const b=bundle(['windows'],[]); b.events.pop(); await assert.rejects(replayTrace(b),/incomplete/);
});
test('recorded picture was searched and not found: the recorded position is not clicked',async()=>{
  const b=bundle(['icon','offset'],[],{node:{locator:{icon:'fixture-png',windowTitle:'Fixture',offsetX:10,offsetY:20}},events:[
    {kind:'observation',source:'icon',value:{hit:null,again:null}},
    {kind:'observation',source:'offset',value:{x:100,y:100,w:800,h:600}},
  ]});
  await assert.rejects(replayTrace(b),/bulunamadı/);
});
test('no recorded picture either: the recorded position is still not clicked',async()=>{
  const b=bundle(['offset'],[],{node:{locator:{windowTitle:'Fixture',offsetX:10,offsetY:20}},events:[
    {kind:'observation',source:'offset',value:{x:100,y:100,w:800,h:600}},
  ]});
  await assert.rejects(replayTrace(b),/bulunamadı/);
});

test('word-level model choice clicks the selected real word, not the phrase midpoint or returned text', async()=>{
  const row=item(7,'Run Remesh',100,80,280,20);
  row.words=[{t:'Run',x:100,y:80,w:40,h:20},{t:'Remesh',x:300,y:80,w:80,h:20}];
  const b=bundle(['list'],[row],{model:true,node:{prompt:'Click remesh'},events:[{kind:'model',source:'list',value:{id:7,wordIndex:1,candidateId:8,text:'Run Remesh',reason:'Remesh is the intended word'}}]});
  const r=await replayTrace(b);
  assert.equal(r.result.x,340); assert.equal(r.result.y,90);
  assert.notEqual(r.result.x,240); assert.equal(r.inputCalls,0);
});
test('invalid word index cannot fall back to the merged phrase center', async()=>{
  const row=item(7,'Run Remesh',100,80,280,20);
  row.words=[{t:'Run',x:100,y:80,w:40,h:20},{t:'Remesh',x:300,y:80,w:80,h:20}];
  const b=bundle(['list'],[row],{model:true,node:{prompt:'Click remesh'},events:[{kind:'model',source:'list',value:{id:7,wordIndex:99,text:'Run Remesh'}}]});
  await assert.rejects(replayTrace(b),/bulunamadı/);
});
test('a one-pixel OCR word stays inside its box after integer click rounding', async()=>{
  const row=item(7,'X',-10,5,1,1); row.words=[{t:'X',x:-10,y:5,w:1,h:1}];
  const b=bundle(['list'],[row],{model:true,node:{prompt:'Click X'},events:[{kind:'model',source:'list',value:{id:7,wordIndex:0,text:'X'}}]});
  const r=await replayTrace(b); assert.equal(r.result.x,-10); assert.equal(r.result.y,5);
});
