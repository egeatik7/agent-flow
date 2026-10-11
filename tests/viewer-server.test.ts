import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { ViewerState, viewerBook } from '../electron/viewer-state'
import { startViewerServer } from '../electron/viewer-server'
import { createNode, type CanvasBook } from '../electron/graph-types'
import type { ViewerMessage } from '../electron/viewer-types'
import { applyViewerMessage } from '../src/viewer/model'

let service:Awaited<ReturnType<typeof startViewerServer>>|undefined,dir=''
const peers:WebSocket[]=[]
afterEach(async()=>{for(const ws of peers)ws.terminate();peers.length=0;await service?.close();service=undefined;if(dir)await rm(dir,{recursive:true,force:true})})
const graph=()=>({nodes:[{...createNode('type',0,0),id:'leaf',text:'Actual live value'}],edges:[]})
async function setup(){dir=await mkdtemp(path.join(tmpdir(),'nubbo-viewer-test-'));await writeFile(path.join(dir,'index.html'),'<html>same build</html>');const state=new ViewerState('1.9.89');service=await startViewerServer(state,dir,'a'.repeat(64),0);return state}
async function peer(){const ws=new WebSocket(`ws://127.0.0.1:${service!.port}/viewer/events`);peers.push(ws);await once(ws,'open');return ws}
async function message(ws:WebSocket){const [raw]=await once(ws,'message');return JSON.parse(raw.toString()) as ViewerMessage}
async function subscribe(ws:WebSocket,token='a'.repeat(64)){const pending=message(ws);ws.send(JSON.stringify({type:'subscribe',protocol:1,token}));return pending}

describe('private read-only tablet transport',()=>{
 it('never serves workspace/settings/tool endpoints and redirects HTML to the monitor',async()=>{
  await setup();const base=`http://127.0.0.1:${service!.port}`
  for(const route of ['/settings','/tools/run','/library.json','/assets/..%2fsecret'])expect((await fetch(base+route)).status).toBe(404)
  expect((await fetch(base+'/viewer',{method:'POST',body:'run'})).status).toBe(405)
  expect((await fetch(base+'/viewer')).status).toBe(200)
  for(const route of ['/','/index.html']){const res=await fetch(base+route,{redirect:'manual'});expect(res.status).toBe(302);expect(res.headers.get('location')).toBe('/viewer')}
 })
 it('rejects a wrong pairing token before sending data and rejects commands after pairing',async()=>{
  await setup();const bad=await peer(),received:unknown[]=[];bad.on('message',p=>received.push(p));const denied=once(bad,'close');bad.send(JSON.stringify({type:'subscribe',protocol:1,token:'b'.repeat(64)}));expect((await denied)[0]).toBe(1008);expect(received).toEqual([])
  const good=await peer();expect((await subscribe(good)).type).toBe('snapshot');const rejected=once(good,'close');good.send(JSON.stringify({type:'run'}));expect((await rejected)[0]).toBe(1008)
 })
 it('handles malformed subscriptions without crashing the PC service',async()=>{
  await setup();for(const body of ['null','[]','{bad json']){const ws=await peer(),closed=once(ws,'close');ws.send(body);expect((await closed)[0]).toBe(1008)}
  const good=await peer();expect((await subscribe(good)).type).toBe('snapshot')
 })
 it('streams live patches and reconnects to the current execution graph, preserving completion',async()=>{
  const state=await setup(),original=graph();state.begin('run','tab:draft',original)
  const ws=await peer();let model=applyViewerMessage(null,await subscribe(ws))
  for(const [channel,payload] of [['agent:patch',{id:'leaf',patch:{text:'lap 5'}}],['agent:step',{id:'leaf',status:'running'}],['hud:loop',{text:'5 / 60'}]] as const){const pending=message(ws);state.event(channel,payload);model=applyViewerMessage(model,await pending)}
  expect(model.run).toEqual(state.snapshot().run);expect(model.run!.graph.nodes[0].text).toBe('lap 5');expect(original.nodes[0].text).toBe('Actual live value')
  const pending=message(ws);state.finish({ok:true});model=applyViewerMessage(model,await pending);ws.terminate()
  const again=await peer(),fresh=applyViewerMessage(null,await subscribe(again));expect(fresh.run).toEqual(model.run);expect(fresh.run!.phase).toBe('completed');expect(fresh.seq).toBe(state.state.seq)
 })
 it('excludes local tab baselines, settings and automation drafts',()=>{
  const book={activeId:'draft',tabs:[{id:'draft',name:'Unsaved',graph:graph(),baseline:{private:'old graph'},automationDraft:{private:'draft'},settings:{apiKey:'secret'}}],library:{canvases:[],automations:[]}} as unknown as CanvasBook
  const safe=viewerBook(book);expect(Object.keys(safe.tabs[0]).sort()).toEqual(['graph','id','name','savedId']);expect(JSON.stringify(safe)).not.toContain('secret');expect(safe.tabs[0].graph).not.toBe(book.tabs[0].graph)
 })
})
