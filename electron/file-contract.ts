import type { AgentGraph, AgentNode } from './graph-types'

/** Stored on Başlangıç: travels with existing graph/package/clipboard persistence. */
export type FileSetup = { version: 1; inputLabel: string; outputLabel: string; inputFilter: string; outputName: string; workFolders: string[]; tools?: boolean; scope?: string }
export type FileFolder = { id: string; name: string; path: string; kind: 'managed' | 'linked'; createdAt: number; available?: boolean; role?: 'work' | 'output' }
export type FileEntry = { name: string; path: string; kind: 'file' | 'folder'; size: number; modifiedAt: number }
export type FileLibraryInfo = { root: string; folders: FileFolder[]; tools: string }
export type FileSelection = { inputId: string; outputId?: string; newOutput: boolean; tools: string }
export type FileRunContext = { version: 1; id: string; canvasKey: string; setup: string; input: string; output: string; workRoot: string; vars: Record<string, string>; roots: string[]; createdAt: number }
export type FileDefaults = { selection?: FileSelection; last?: FileRunContext }
export type ListSource = { kind: 'files' | 'folders' | 'all'; filter: string; recursive?: boolean }
export function normalizeListSource(raw: unknown): ListSource | undefined {
  if (raw === undefined) return
  const s = raw as ListSource
  if (!s || !['files', 'folders', 'all'].includes(s.kind) || typeof s.filter !== 'string' || s.filter.length > 500) throw new Error('Döngü dosya kaynağı geçersiz.')
  return { kind: s.kind, filter: s.filter, recursive: s.recursive === true }
}
export const DEFAULT_FILE_SETUP: FileSetup = { version: 1, inputLabel: 'Giriş klasörü', outputLabel: 'Çıkış klasörü', inputFilter: '*', outputName: 'Çıktılar', workFolders: ['hazirlik', 'queue', 'hesaplar', 'sekmeler', 'indirme', 'remesh', 'raporlar'], tools: true }
export const FILE_KEY = /^[a-z][a-z0-9_-]{0,47}$/
export function normalizeFileSetup(raw: unknown): FileSetup | undefined {
  if (raw === undefined) return
  const s = raw as FileSetup
  if (!s || s.version !== 1 || !Array.isArray(s.workFolders) || s.workFolders.some(x => typeof x !== 'string' || !FILE_KEY.test(x) || x === 'kod') || new Set(s.workFolders).size !== s.workFolders.length) throw new Error('Dosya çalışma ayarları geçersiz.')
  for (const k of ['inputLabel', 'outputLabel', 'inputFilter', 'outputName'] as const) if (typeof s[k] !== 'string' || !s[k].trim() || s[k].length > 200) throw new Error(`Dosya ayarı geçersiz: ${k}`)
  if (s.scope !== undefined && (typeof s.scope !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(s.scope))) throw new Error('Dosya çalışma kimliği geçersiz.')
  return { version: 1, inputLabel: s.inputLabel, outputLabel: s.outputLabel, inputFilter: s.inputFilter, outputName: s.outputName, workFolders: [...s.workFolders], tools: s.tools !== false, ...(s.scope ? { scope: s.scope } : {}) }
}
function setupNode(g: AgentGraph): AgentNode | undefined {
  const own = g.nodes.find(n => n.kind === 'start' && n.fileSetup)
  if (own) return own
  for (const n of g.nodes) if (n.inner) { const found = setupNode(n.inner); if (found) return found }
}
export const fileSetup = (g: AgentGraph): FileSetup | undefined => setupNode(g)?.fileSetup
export const fileCanvasKey = (g: AgentGraph): string => setupNode(g)?.fileSetup?.scope ?? setupNode(g)?.id ?? g.nodes.find(n => n.kind === 'start')?.id ?? ''
/** A separately saved copy gets its own defaults/resume identity, never another tab's last job. */
export function withFileScope(g: AgentGraph, scope: string): AgentGraph {
  const next = structuredClone(g), node = setupNode(next)
  if (node?.fileSetup) node.fileSetup = { ...node.fileSetup, scope }
  return next
}
export const fileSetupKey = (s: FileSetup): string => JSON.stringify(normalizeFileSetup(s))
export function hasFileFeatures(g: AgentGraph): boolean { return g.nodes.some(n => !!n.fileSetup || !!n.listSource || ['text', 'prompt', 'keys', 'folder', 'source', 'pattern', 'url'].some(k => /\{\{\s*(?:girdi|cikti|calisma|araclar|klasor\.|dongu\.)/i.test(String(n[k as keyof AgentNode] ?? ''))) || !!n.inner && hasFileFeatures(n.inner)) }
export function fileTokens(g: AgentGraph): { token: string; label: string }[] {
  const s = fileSetup(g)
  return [
    { token: '{{girdi}}', label: s?.inputLabel ?? 'Giriş klasörü' },
    { token: '{{cikti}}', label: s?.outputLabel ?? 'Çıkış klasörü' },
    { token: '{{calisma}}', label: 'Bu çalışmanın klasörü' },
    { token: '{{calisma.kod}}', label: 'Bu çalışmanın benzersiz adı' },
    ...(s?.workFolders ?? DEFAULT_FILE_SETUP.workFolders).map(k => ({ token: `{{calisma.${k}}}`, label: `Çalışma: ${k}` })),
    { token: '{{araclar}}', label: 'Nubbo Tools klasörü' },
  ]
}
export function isFileToken(token: string) { return /^\{\{\s*(?:girdi|cikti|calisma(?:\.[\w-]+)?|araclar|klasor\.[\w-]+)\s*\}\}$/i.test(token) }
/** Keep legacy values unchanged; explicit loop references retain each outer frame. */
export function scopedItemVars(n: AgentNode, item: string, index: number, total: number): Record<string, string> {
  const ad = item.split(/[\\/]/).pop() ?? item
  const stem = n.listSource?.kind === 'folders' ? ad : ad.replace(/\.[^.]+$/, '')
  const prefix = `dongu.${n.id.toLowerCase()}.`
  return { [prefix + 'yol']: item, [prefix + 'ad']: ad, [prefix + 'isim']: stem, [prefix + 'sira']: String(index + 1), [prefix + 'toplam']: String(total) }
}
export function assertFileValues(node: AgentNode, vars: Record<string, string>): void {
  for (const field of ['text', 'prompt', 'keys', 'folder', 'source', 'pattern', 'url'] as const) {
    // Loop folders are resolved separately in their outer frame.
    if (field === 'folder' && node.kind === 'loop') continue
    for (const m of (node[field] ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if ((isFileToken(m[0]) || /^dongu\./i.test(m[1])) && vars[m[1].trim().toLowerCase()] === undefined) throw new Error(`“${node.title}”: ${m[0]} seçilmemiş veya bu kapsamda bulunmuyor. Dosyalar’dan çalışma klasörlerini seç.`)
    }
  }
}
