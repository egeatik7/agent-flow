import type { AgentGraph, CanvasBook, StepStatus } from './graph-types'
import type { RecoveryReport } from './recovery'
export type ViewerBook = { zipLibrary: import('./zip-library-storage').ZipLibrarySnapshot; tabs: Pick<CanvasBook['tabs'][number], 'id'|'savedId'|'name'|'graph'>[] }
export type ViewerRun = { id: string; canvasId: string; name: string; graph: AgentGraph; phase: 'running'|'completed'|'stopped'|'failed'; nodeId: string|null; status: Record<string,StepStatus>; edges: {id:string;from:string;to:string}[]; loop: string; method: string; recovery?: {active:boolean;nodeTitle:string;message:string} }
export type ViewerHud = { level: 'info'|'warn'|'error'|'success'; text: string; loop: string; method: string; countdown: string; recovering: boolean }
export type ViewerSnapshot = { protocol: 1; version: string; session: string; seq: number; at: number; book: ViewerBook; run: ViewerRun|null; hud?: ViewerHud; logs: {level:string;message:string;at:number}[]; reports: RecoveryReport[] }
export type ViewerMessage = { type:'snapshot'; state:ViewerSnapshot } | { type:'event'; session:string; seq:number; at:number; channel:string; payload:unknown } | {type:'heartbeat';session:string;seq:number;at:number}
export type ViewerInfo = { enabled:boolean; port?:number; url?:string; qr?:string; error?:string }
