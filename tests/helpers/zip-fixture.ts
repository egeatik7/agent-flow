import type { CanvasBook } from '../../electron/graph-types'
export function withZipFixture(book: CanvasBook): CanvasBook {
  const canvases = book.tabs.map(t => ({...structuredClone(t.graph),format:'nubbo-canvas' as const,version:1 as const,canvasId:t.canvasId ?? t.id,name:t.name}))
  return {...book,workspaceVersion:3,zipLibrary:{directory:'library',groups:[{id:'Test.zip',name:'Test',archived:false,revision:'fixture',canvases}]},tabs:book.tabs.map((t,i)=>({...t,savedId:canvases[i].canvasId,canvasId:canvases[i].canvasId,baseline:{name:t.name,graph:structuredClone(t.graph)}}))}
}
