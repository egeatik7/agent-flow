import type { CanvasTab } from './graph-types'
import type { ZipLibrarySnapshot } from './zip-library-storage'
import type { ZipCanvasDocument } from './zip-canvas-document'
export type ZipLibraryAction =
  | { action: 'create'; name: string; archived?: boolean }
  | { action: 'rename'; id: string; name: string; revision: string }
  | { action: 'archive'; id: string; archived: boolean; revision: string }
  | { action: 'deleteGroup'; id: string; revision: string }
  | { action: 'reorder'; id: string; order: string[]; revision: string }
  | { action: 'deleteCanvas'; id: string; canvasId: string; revision: string }
  | { action: 'deleteCanvases'; id: string; canvasIds: string[]; revision: string }
  | { action: 'renameCanvas'; id: string; canvasId: string; name: string; revision: string }
  | { action: 'copyCanvas'; id: string; canvasId: string; revision: string }
  | { action: 'saveCanvas'; tab: CanvasTab; id?: string; revision?: string; name?: string; copy?: boolean }
  | { action: 'import'; copy?: boolean; archived?: boolean }
  | { action: 'export'; id: string; revision: string }
export type ZipLibraryResult = { library: ZipLibrarySnapshot; canvas?: ZipCanvasDocument }
