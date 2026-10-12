import { newId, type CanvasLibrary, type CanvasBook, type LibraryFolder } from './graph-types'
import { libraryOf } from './canvas-library'
export type LibraryRef = { kind: 'folder' | 'canvas' | 'automation'; id: string }
export type LibraryChange =
 | { action: 'newFolder'; name: string; parentId?: string; section?: import('./graph-types').LibrarySection }
 | { action: 'renameFolder'; id: string; name: string }
 | { action: 'move'; refs: LibraryRef[]; parentId?: string }
 | { action: 'archive'; refs: LibraryRef[]; archived: boolean }
 | { action: 'deleteFolder'; id: string }
export function isArchived(lib: CanvasLibrary, item: { archived?: boolean; folderId?: string; parentId?: string }): boolean {
 const seen = new Set<string>(); let at = item.folderId ?? item.parentId
 if (item.archived) return true
 while (at) { if (seen.has(at)) return true; seen.add(at); const f = lib.folders?.find(f => f.id === at); if (!f) break; if (f.archived) return true; at = f.parentId }
 return false
}
export function validateLibrary(lib: CanvasLibrary): void {
 if (!lib || !Array.isArray(lib.canvases) || !Array.isArray(lib.automations) || (lib.folders !== undefined && !Array.isArray(lib.folders))) throw Error('Kütüphane biçimi geçersiz.')
 const folders = lib.folders ?? []
 for (const rows of [folders, lib.canvases, lib.automations]) {
  const ids = new Set<string>()
  for (const row of rows) {
   if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim()) throw Error('Kütüphanede geçersiz veya tekrarlı kimlik var.')
   ids.add(row.id)
  }
 }
 for (const f of folders) {
  const seen = new Set<string>([f.id]); let at = f.parentId
  while (at) { if (seen.has(at)) throw Error('Klasör kendi içine taşınamaz.'); seen.add(at); const parent = folders.find(v => v.id === at); if (!parent) throw Error('Üst klasör bulunamadı.'); at = parent.parentId }
 }
 for (const item of [...lib.canvases, ...lib.automations]) if (item.folderId && !folders.some(f => f.id === item.folderId)) throw Error('Öğenin klasörü bulunamadı.')
 for (const c of lib.canvases) if (!Array.isArray(c.graph?.nodes) || !Array.isArray(c.graph?.edges)) throw Error('Tuval içeriği bozuk.')
 for (const a of lib.automations) {
  if (!Array.isArray(a.entries)) throw Error('Otomasyon sırası bozuk.')
  const entries = new Set<string>()
  for (const e of a.entries) { if (!e.id || entries.has(e.id) || !lib.canvases.some(c => c.id === e.canvasId)) throw Error('Otomasyon bağlantısı geçersiz.'); entries.add(e.id) }
 }
}
/**
 * Bölümü olmayan klasörleri güvenle bir bölüme bağlar — alt ağacın TAMAMINA bakarak (aşağıdan yukarı),
 * deterministik olarak (id üretmez). Tek tür içeren alt ağaç o bölüme geçer; hem tuval hem otomasyon
 * içeren alt ağaçta bölüm YAZILMAZ ve klasör iki bölümde de görünür. Böylece hiçbir kayıt görünmez kalmaz.
 * İdempotenttir: ikinci çağrı hiçbir şey değiştirmez.
 */
export function ensureSections(lib: CanvasLibrary): CanvasLibrary {
 const folders = lib.folders ?? []
 if (!folders.length) return lib
 const ihtiyac = (f: LibraryFolder): { c: boolean; a: boolean } => {
  let c = lib.canvases.some(x => x.folderId === f.id), a = lib.automations.some(x => x.folderId === f.id)
  for (const k of folders.filter(x => x.parentId === f.id)) { const i = ihtiyac(k); c = c || i.c; a = a || i.a }
  return { c, a }
 }
 for (const f of folders) {
  if (f.section) continue
  const i = ihtiyac(f)
  if (i.a && !i.c) f.section = 'automation'
  else if (!i.a) f.section = 'canvas'
 }
 return lib
}
export function changeLibrary(book: CanvasBook, change: LibraryChange): CanvasBook {
 const lib = structuredClone(libraryOf(book)); lib.folders ??= []
 const name = ('name' in change ? change.name : '').trim().slice(0, 80)
 if (change.action === 'newFolder' || change.action === 'renameFolder') {
  if (!name) throw Error('Klasör adı boş olamaz.')
  if (change.action === 'newFolder') { if (lib.folders.some(o => o.parentId === change.parentId && o.section === change.section && o.name.trim().toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) throw Error('Bu klasörde aynı adlı bir klasör var; farklı bir ad seç.'); const ust = change.parentId ? lib.folders.find(f => f.id === change.parentId) : undefined; const section = ust?.section ?? change.section; lib.folders.push({ id: newId(), name, parentId: change.parentId, ...(section ? { section } : {}) }) }
  else { const f = lib.folders.find(f => f.id === change.id); if (!f) throw Error('Klasör bulunamadı.'); if (lib.folders.some(o => o.id !== f.id && o.parentId === f.parentId && o.section === f.section && o.name.trim().toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) throw Error('Bu klasörde aynı adlı başka bir klasör var; farklı bir ad seç.'); f.name = name }
 } else if (change.action === 'deleteFolder') {
  if (lib.folders.some(f => f.parentId === change.id) || [...lib.canvases, ...lib.automations].some(c => c.folderId === change.id)) throw Error('Klasör dolu. İçeriğini taşı veya klasörü arşivle.')
  lib.folders = lib.folders.filter(f => f.id !== change.id)
 } else {
  // Otomasyonlarda ARŞİV yoktur (kullanıcı isteği): otomasyon başvuruları atlanır, kalanlar arşivlenir.
  if (change.action === 'archive' && !change.refs.some(r => r.kind !== 'automation')) return { ...book, library: lib }
  const hedefler = change.action === 'archive' ? change.refs.filter(r => r.kind !== 'automation') : change.refs
  const selectedFolders = new Set(hedefler.filter(r => r.kind === 'folder').map(r => r.id))
  const refs = hedefler.filter(ref => {
   if (change.action === 'archive' && !change.archived) return true
   const item = ref.kind === 'folder' ? lib.folders!.find(f => f.id === ref.id) : (ref.kind === 'canvas' ? lib.canvases : lib.automations).find(c => c.id === ref.id)
   let parent = ref.kind === 'folder' ? (item as LibraryFolder | undefined)?.parentId : (item as {folderId?:string}|undefined)?.folderId
   const seen = new Set<string>()
   while(parent && !seen.has(parent)) { if(selectedFolders.has(parent))return false;seen.add(parent);parent=lib.folders!.find(f=>f.id===parent)?.parentId }
   return true
  })
  if(change.action==='archive' && !change.archived) for(const ref of refs) {
   const item=(ref.kind==='folder'?lib.folders:ref.kind==='canvas'?lib.canvases:lib.automations).find(v=>v.id===ref.id)
   if(item)item.archived=false
  }
  for (const ref of refs) {
   const rows = ref.kind === 'folder' ? lib.folders : ref.kind === 'canvas' ? lib.canvases : lib.automations
   const item = rows.find(v => v.id === ref.id); if (!item) throw Error('Taşınacak öğe artık yok.')
   if (change.action === 'archive') { item.archived = change.archived; if (!change.archived && isArchived(lib, item)) { if (ref.kind === 'folder') (item as LibraryFolder).parentId = undefined; else (item as {folderId?:string}).folderId = undefined } }
   else if (ref.kind === 'folder') {
     const folder = item as LibraryFolder
     const target = change.parentId ? lib.folders.find(f => f.id === change.parentId) : undefined
     const descendants = new Set([folder.id]); let grew = true
     while (grew) { grew = false; for (const child of lib.folders) if (child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) { descendants.add(child.id); grew = true } }
     if (change.parentId && descendants.has(change.parentId)) throw Error('Klasör kendi içine taşınamaz.')
     if (target?.section && ((target.section === 'automation' && lib.canvases.some(c => c.folderId && descendants.has(c.folderId))) || (target.section === 'canvas' && lib.automations.some(a => a.folderId && descendants.has(a.folderId))))) throw Error('Klasör içeriği hedef bölümle uyuşmuyor; farklı bölümün içine taşınmadı.')
     folder.parentId = change.parentId
     if (target?.section) for (const child of lib.folders) if (descendants.has(child.id)) child.section = target.section
     if (lib.folders.some(other => other.id !== folder.id && other.parentId === folder.parentId && other.section === folder.section && other.name.trim().toLocaleLowerCase('tr') === folder.name.trim().toLocaleLowerCase('tr'))) throw Error('Hedefte aynı adlı bir klasör var; taşıma yapılmadı.')
   }
   else {
     const target = change.parentId ? lib.folders.find(f => f.id === change.parentId) : undefined
     if (target?.section && target.section !== ref.kind) throw Error('Öğe hedef bölümle uyuşmuyor; farklı bölümün içine taşınmadı.')
     const row = item as { folderId?: string; section?: never }
     row.folderId = change.parentId
   }
  }
 }
 validateLibrary(lib)
 // Silinen/yok olan klasörde bekleyen otomasyon taslağı görünmez ve kaydedilemez kalmasın.
 const automationDraft = book.automationDraft?.folderId && !lib.folders.some(f => f.id === book.automationDraft!.folderId)
  ? { ...book.automationDraft, folderId: undefined }
  : book.automationDraft
 return { ...book, library: lib, automationDraft }
}
