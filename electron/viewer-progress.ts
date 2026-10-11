import type { AgentGraph } from './graph-types'
import { ancestors } from './groups'
/** Packages and loop boxes enclosing a live step, shared by server and tablet. */
export function viewerNodePath(graph:AgentGraph,id:string):string[]{
 if(graph.nodes.some(n=>n.id===id))return [...ancestors(graph,id).reverse().map(n=>n.id),id]
 for(const n of graph.nodes){if(n.kind!=='package'||!n.inner)continue;const path=viewerNodePath(n.inner,id);if(path.length)return [...ancestors(graph,n.id).reverse().map(p=>p.id),n.id,...path]}
 return []
}
