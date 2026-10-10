import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { removeRecoveryReportFiles } from '../electron/recovery-report-files'
import type { RecoveryReport } from '../electron/recovery'
import RecoveryNote from '../src/components/RecoveryNote'
import { useRecoveryReports } from '../src/hooks/useRecoveryReports'
const report: RecoveryReport = { id: 'recovery-1-fixture', nodeId: 'node', nodeTitle: 'Action', startedAt: 1, endedAt: 2,
  model: 'fixture', error: 'Missing', context: {}, result: 'failed', probableCause: '', evidence: '', summary: '', actions: [] }
let mounted: ReactTestRenderer | undefined
const dirs: string[] = []
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-cleanup-')); dirs.push(dir); return dir }
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals(); dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })) })
it('cleans just report files and rejects traversal before deleting anything', () => {
  const dir = tempDir(), notified = vi.fn()
  fs.writeFileSync(path.join(dir, 'recovery-1-a.json'), '{}')
  fs.writeFileSync(path.join(dir, 'recovery-2-b.json'), '{}')
  fs.writeFileSync(path.join(dir, 'canvas.json'), '{}')
  fs.writeFileSync(path.join(dir, 'screen.png'), 'pixels')
  expect(() => removeRecoveryReportFiles(dir, ['recovery-1-a', '../canvas'], notified)).toThrow('Geçersiz')
  expect(fs.existsSync(path.join(dir, 'recovery-1-a.json'))).toBe(true)
  removeRecoveryReportFiles(dir, ['recovery-1-a'], notified)
  expect(fs.readdirSync(dir)).toContain('recovery-2-b.json')
  removeRecoveryReportFiles(dir, undefined, notified)
  expect(fs.readdirSync(dir).sort()).toEqual(['canvas.json', 'screen.png'])
  expect(notified.mock.calls).toEqual([[['recovery-1-a']], [['recovery-2-b']]])
})
it('does not recreate a deleted note when the pending recovery result is saved later', () => {
  const dir = tempDir(), sent = vi.fn()
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.resolve('electron/main.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveRecoveryReport')!
  const code = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const deleted = new Set<string>()
  const context = vm.createContext({ fs, path, removedRecoveryReportIds: deleted, recoveryReportsDir: () => dir, send: sent })
  vm.runInContext(code, context)
  context.saveRecoveryReport(report)
  removeRecoveryReportFiles(dir, [report.id], ids => ids.forEach(id => deleted.add(id)))
  context.saveRecoveryReport({ ...report, resumed: true })
  expect(fs.existsSync(path.join(dir, `${report.id}.json`))).toBe(false)
  expect(sent).toHaveBeenCalledTimes(1)
})
it.each(['one', 'all'] as const)('confirms %s cleanup inside the note and supports cancellation', async kind => {
  const remove = vi.fn(async () => true), clear = vi.fn(async () => true)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), xpAgent: { removeRecoveryReport: remove, clearRecoveryReports: clear } })
  await act(async () => { mounted = create(createElement(RecoveryNote, { reports: [report], title: 'Action', onClose: vi.fn() })) })
  const button = (text: string) => mounted!.root.findAllByType('button').find(b => b.children.includes(text))!
  const label = kind === 'one' ? 'Bu raporu temizle' : 'Tüm raporları temizle'
  act(() => button(label).props.onClick())
  expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled()
  act(() => button('Vazgeç').props.onClick())
  expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled()
  act(() => button(label).props.onClick())
  await act(async () => { button('Evet, temizle').props.onClick() })
  if (kind === 'one') { expect(remove).toHaveBeenCalledExactlyOnceWith(report.id); expect(clear).not.toHaveBeenCalled() }
  else { expect(clear).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled() }
})
it('does not bring a deleted note back from a late snapshot or report event', async () => {
  let snapshot!: (reports: RecoveryReport[]) => void
  let removed!: (ids: string[]) => void, incoming!: (report: RecoveryReport) => void
  vi.stubGlobal('window', { xpAgent: {
    recoveryReports: () => new Promise<RecoveryReport[]>(resolve => { snapshot = resolve }),
    onRecoveryReportsRemoved: (cb: typeof removed) => { removed = cb; return vi.fn() },
    onRecoveryReport: (cb: typeof incoming) => { incoming = cb; return vi.fn() },
  } })
  function Harness() { return createElement('span', null, useRecoveryReports(false).length) }
  act(() => { mounted = create(createElement(Harness)) })
  act(() => { incoming(report); removed([report.id]) })
  await act(async () => { snapshot([report]) })
  act(() => incoming({ ...report, resumed: true }))
  expect(mounted!.root.findByType('span').children).toEqual(['0'])
})

it('opens the report folder and copies the currently displayed report text', async () => {
  const folder = vi.fn(async () => 'fixture-folder'), copy = vi.fn(async (_text: string) => true)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), xpAgent: { openRecoveryReports: folder, copyRecoveryReportText: copy } })
  const older = { ...report, id: 'recovery-0-older', summary: 'Older report summary' }
  await act(async () => { mounted = create(createElement(RecoveryNote, { reports: [report, older], title: 'Action', onClose: vi.fn() })) })
  await act(async () => { mounted!.root.findAllByType('button').find(b => b.children.includes('Rapor klasörünü aç'))!.props.onClick() })
  expect(folder).toHaveBeenCalledOnce()
  act(() => mounted!.root.findByProps({ 'aria-label': 'Raporlar' }).findAllByType('button')[1].props.onClick())
  await act(async () => { mounted!.root.findByProps({ 'aria-label': 'Rapor metnini kopyala' }).props.onClick() })
  expect(copy).toHaveBeenCalledOnce()
  expect(copy.mock.calls[0][0]).toContain('Older report summary')
  expect(copy.mock.calls[0][0]).toContain('Hata: Missing')
  expect(copy.mock.calls[0][0]).not.toContain('Tüm raporları temizle')
  expect(mounted!.root.findByProps({ role: 'status' }).children).toEqual(['Rapor kopyalandı.'])
})
