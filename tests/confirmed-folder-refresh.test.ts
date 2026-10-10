import {act,createElement} from 'react'
import {create, type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'
import {createNode,DEFAULT_SETTINGS} from '../electron/graph-types'
import NodeCanvas from '../src/components/NodeCanvas'
import CanvasTabs from '../src/components/CanvasTabs'
import SidePanel from '../src/components/SidePanel'
vi.mock('../src/components/TitleBar',()=>({default:()=>null}))
vi.mock('../src/components/Toolbar',()=>({default:()=>null}))
vi.mock('../src/components/NodeCanvas',()=>({default:()=>null}))
vi.mock('../src/components/CanvasTabs',()=>({default:()=>null}))
vi.mock('../src/components/SidePanel',()=>({default:()=>null}))
vi.mock('../src/components/LogPanel',()=>({default:()=>null}))
let App:any,book:any,mounted:ReactTestRenderer|undefined
let list: (s:string)=>Promise<string[]>=async()=>[]
const api:any={getSettings:async()=>DEFAULT_SETTINGS,getCanvases:async()=>structuredClone(book),saveCanvases:async()=>true,listWindows:async()=>[],bootReady:()=>{},onAgentLog:()=>()=>{},onAgentStep:()=>()=>{},onAgentPatch:()=>()=>{},listDir:(s:string)=>list(s)}
beforeAll(async()=>{
 vi.stubGlobal('window',{xpAgent:api,addEventListener:()=>{},removeEventListener:()=>{},setTimeout,clearTimeout})
 vi.stubGlobal('requestAnimationFrame',(cb:any)=>{cb();return 0})
 App=(await import('../src/App')).default
})
beforeEach(()=>{window.setTimeout=setTimeout as any;window.clearTimeout=clearTimeout as any})
afterEach(()=>{if(mounted)act(()=>mounted!.unmount());mounted=undefined;vi.useRealTimers()})
const catalog=()=>mounted!.root.findByType(SidePanel).props.canvasPanel.props
const open=async(id:string)=>{await act(async()=>{await catalog().onOpenCanvas(book.library.canvases.find((c:any)=>c.id===id))})}
it('updating loop B preserves the independent folder refresh of loop A',async()=>{
 vi.useFakeTimers()
 window.setTimeout=setTimeout as any;window.clearTimeout=clearTimeout as any
 const a=createNode('loop',0,0),b=createNode('loop',0,200);a.items=['old-A.glb'];a.folder='old-A';b.items=['old-B.glb'];b.folder='old-B'
 const graph={nodes:[createNode('start',0,0),a,b],edges:[]}
 book={activeId:'',tabs:[],library:{schemaVersion:2,automations:[],canvases:[{id:'A',name:'A',graph,updatedAt:1}]}}
 list=async(s)=>[s+'-new.glb']
 await act(async()=>{mounted=create(createElement(App))});await open('A')
 await act(async()=>{mounted!.root.findByType(SidePanel).props.onLoopFolder(a.id,'new-A')})
 await act(async()=>{vi.advanceTimersByTime(200);mounted!.root.findByType(SidePanel).props.onLoopFolder(b.id,'new-B')})
 await act(async()=>{vi.advanceTimersByTime(401);await Promise.resolve()})
 const nodes=mounted!.root.findByType(NodeCanvas).props.graph.nodes
 expect(nodes.find((n:any)=>n.id===a.id)).toMatchObject({folder:'new-A',items:['new-A-new.glb']})
 expect(nodes.find((n:any)=>n.id===b.id)).toMatchObject({folder:'new-B',items:['new-B-new.glb']})

})
it('late old response cannot replace the newer folder of the same loop',async()=>{
 vi.useFakeTimers();window.setTimeout=setTimeout as any;window.clearTimeout=clearTimeout as any;
 const a=createNode('loop',0,0);a.folder='old';a.items=['old.glb']
 book={activeId:'',tabs:[],library:{schemaVersion:2,automations:[],canvases:[{id:'A',name:'A',graph:{nodes:[a],edges:[]},updatedAt:1}]}}
 const replies=new Map<string,(files:string[])=>void>()
 list=folder=>new Promise(resolve=>replies.set(folder,resolve))
 await act(async()=>{mounted=create(createElement(App))});await open('A')
 await act(async()=>{mounted!.root.findByType(SidePanel).props.onLoopFolder(a.id,'first')})
 await act(async()=>{vi.advanceTimersByTime(401)})
 await act(async()=>{mounted!.root.findByType(SidePanel).props.onLoopFolder(a.id,'second')})
 await act(async()=>{vi.advanceTimersByTime(401)})
 await act(async()=>{replies.get('second')!(['second.glb'])})
 await act(async()=>{replies.get('first')!(['first.glb'])})
 expect(mounted!.root.findByType(NodeCanvas).props.graph.nodes.find((n:any)=>n.id===a.id)).toMatchObject({folder:'second',items:['second.glb']})
})
it('folder result belongs to its original tab after switching canvases',async()=>{
 vi.useFakeTimers();window.setTimeout=setTimeout as any;window.clearTimeout=clearTimeout as any;
 const a=createNode('loop',0,0);a.folder='old';a.items=['old.glb']
 const graph={nodes:[a],edges:[]}
 book={activeId:'',tabs:[],library:{schemaVersion:2,automations:[],canvases:[{id:'A',name:'A',graph,updatedAt:1},{id:'B',name:'B',graph,updatedAt:1}]}}
 let reply!:(files:string[])=>void
 list=()=>new Promise(resolve=>{reply=resolve})
 await act(async()=>{mounted=create(createElement(App))});await open('A')
 const firstId=mounted!.root.findByType(CanvasTabs).props.activeId
 await act(async()=>{mounted!.root.findByType(SidePanel).props.onLoopFolder(a.id,'new-A')})
 await act(async()=>{vi.advanceTimersByTime(401)})
 await open('B')
 await act(async()=>{reply(['new-A.glb'])})
 expect(mounted!.root.findByType(NodeCanvas).props.graph.nodes.find((n:any)=>n.id===a.id)).toMatchObject({folder:'old',items:['old.glb']})
 await act(async()=>{mounted!.root.findByType(CanvasTabs).props.onSelect(firstId)})
 expect(mounted!.root.findByType(NodeCanvas).props.graph.nodes.find((n:any)=>n.id===a.id)).toMatchObject({folder:'new-A',items:['new-A.glb']})
})
