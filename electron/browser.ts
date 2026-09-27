import fs from 'fs'
import path from 'path'
import type { BrowserContext, Download, FileChooser, Page } from 'playwright-core'
import { norm, type ScreenItem } from './matcher'

type Log = (level: 'info' | 'warn' | 'success', msg: string) => void

let ctx: BrowserContext | null = null
let page: Page | null = null
let chooser: { fc: FileChooser; at: number } | null = null
let downloadsDir = ''
let log: Log = () => {}
const saving = new Set<Promise<unknown>>()

const IS_WIN = process.platform === 'win32'

function channels(pref: 'auto' | 'msedge' | 'chrome'): ('msedge' | 'chrome')[] {
  if (pref === 'msedge') return ['msedge', 'chrome']
  if (pref === 'chrome') return ['chrome', 'msedge']
  return IS_WIN ? ['msedge', 'chrome'] : ['chrome', 'msedge']
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p
  const ext = path.extname(p)
  const stem = p.slice(0, p.length - ext.length)
  for (let i = 2; i < 1000; i++) {
    const c = `${stem} (${i})${ext}`
    if (!fs.existsSync(c)) return c
  }
  return `${stem} (${Date.now()})${ext}`
}

async function saveDownload(d: Download) {
  const name = d.suggestedFilename() || `indirilen-${Date.now()}`
  log('info', `[tarayıcı] İndirme başladı: ${name}`)
  const job = (async () => {
    const tmp = path.join(downloadsDir, `.${name}.xpas-part`)
    try {
      fs.mkdirSync(downloadsDir, { recursive: true })
      await d.saveAs(tmp)
      const target = uniquePath(path.join(downloadsDir, name))
      fs.renameSync(tmp, target)
      log('success', `[tarayıcı] İndirildi: ${target}`)
    } catch (e) {
      log('warn', `[tarayıcı] İndirme kaydedilemedi (${name}): ${(e as Error).message}`)
      try {
        fs.rmSync(tmp, { force: true })
      } catch {
        /* nothing to clean */
      }
    }
  })()
  saving.add(job)
  void job.finally(() => saving.delete(job))
}

function wire(p: Page) {
  p.on('download', (d) => void saveDownload(d))
  p.on('filechooser', (fc) => {
    chooser = { fc, at: Date.now() }
    log('info', '[tarayıcı] Dosya seçme penceresi açıldı; sıradaki Yazı Yaz adımındaki yol doğrudan verilecek.')
  })
  p.on('close', () => {
    if (page === p) page = ctx?.pages().filter((x) => !x.isClosed()).pop() ?? null
  })
}

export function isOpen(): boolean {
  return !!ctx && !!page && !page.isClosed()
}

export async function open(opts: {
  url: string
  browser: 'auto' | 'msedge' | 'chrome'
  profileDir: string
  downloadsDir: string
  log: Log
}): Promise<void> {
  log = opts.log
  downloadsDir = opts.downloadsDir
  if (!isOpen()) {
    const { chromium } = await import('playwright-core')
    let lastErr: Error | null = null
    for (const channel of channels(opts.browser)) {
      try {
        ctx = await chromium.launchPersistentContext(opts.profileDir, {
          channel,
          headless: false,
          acceptDownloads: true,
          viewport: null,
          args: ['--start-maximized', '--disable-features=DownloadBubble'],
        })
        log('success', `[tarayıcı] ${channel === 'msedge' ? 'Edge' : 'Chrome'} açıldı (programın kendi profili; girişler hatırlanır).`)
        break
      } catch (e) {
        lastErr = e as Error
        ctx = null
      }
    }
    if (!ctx) {
      throw new Error(
        `Tarayıcı açılamadı. Edge veya Chrome yüklü olmalı. ${lastErr?.message.split('\n')[0] ?? ''}`.trim()
      )
    }
    ctx.on('page', (p) => {
      page = p
      wire(p)
    })
    ctx.on('close', () => {
      ctx = null
      page = null
      chooser = null
    })
    for (const p of ctx.pages()) wire(p)
    page = ctx.pages()[0] ?? (await ctx.newPage())
  }
  const url = opts.url.trim()
  if (url && url !== 'https://' && page) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  }
  await settle()
  await page?.bringToFront()
}

export async function close() {
  try {
    await ctx?.close()
  } catch {
    /* already closed */
  }
  ctx = null
  page = null
}

export async function settle(ms = 2500) {
  if (!page) return
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {})
}

export async function title(): Promise<string> {
  try {
    return page ? await page.title() : ''
  } catch {
    return ''
  }
}

/** The browser we launched is the foreground window (its title contains the page title). */
export async function looksForeground(fgTitle: string | null): Promise<boolean> {
  if (!isOpen()) return false
  if (fgTitle === null) return true
  const t = norm(await title())
  const f = norm(fgTitle)
  if (!f) return false
  if (t && f.includes(t.slice(0, 40))) return true
  return !t && /edge|chrome/.test(f)
}

/** Plain script (not a function) so no bundler helper leaks into the page. */
const COLLECT = `(() => {
  const INTERACTIVE = 'a[href],button,input,textarea,select,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[contenteditable=""],[contenteditable=true],[onclick]';
  const vw = window.innerWidth, vh = window.innerHeight;
  document.querySelectorAll('[data-xpas]').forEach(function (el) { el.removeAttribute('data-xpas'); });
  function clean(s) { return (s || '').replace(/\\s+/g, ' ').trim().slice(0, 90); }
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return null;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return null;
    return r;
  }
  function kind(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' || role === 'link') return 'Hyperlink';
    if (tag === 'select') return 'ComboBox';
    if (tag === 'textarea' || el.isContentEditable) return 'Edit';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image', 'file'].indexOf(type) >= 0) return 'Button';
      if (type === 'checkbox') return 'CheckBox';
      if (type === 'radio') return 'RadioButton';
      return 'Edit';
    }
    if (tag === 'button' || role === 'button' || tag === 'summary') return 'Button';
    if (role === 'tab') return 'TabItem';
    if (role === 'menuitem') return 'MenuItem';
    if (role === 'option') return 'ListItem';
    if (role === 'checkbox' || role === 'switch') return 'CheckBox';
    if (role === 'radio') return 'RadioButton';
    return 'Text';
  }
  function label(el) {
    const aria = clean(el.getAttribute('aria-label'));
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const lab = el.labels && el.labels[0] ? clean(el.labels[0].innerText) : '';
      return aria || lab || clean(el.placeholder) || clean(el.getAttribute('title')) || clean(el.name) || (el.type === 'file' ? 'Dosya seç' : '');
    }
    const img = el.querySelector('img[alt]');
    return aria || clean(el.innerText) || clean(el.getAttribute('title')) || clean(img && img.getAttribute('alt'));
  }
  const out = [];
  const seen = new Set();
  function add(el, text) {
    if (seen.has(el) || !text || out.length >= 700) return;
    const r = visible(el);
    if (!r) return;
    seen.add(el);
    el.setAttribute('data-xpas', String(out.length + 1));
    out.push({ text: text, type: kind(el), x: r.left, y: r.top, w: r.width, h: r.height });
  }
  document.querySelectorAll(INTERACTIVE).forEach(function (el) { add(el, label(el)); });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode()) && out.length < 700) {
    const txt = clean(t.textContent);
    const parent = t.parentElement;
    if (!txt || txt.length < 2 || !parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].indexOf(parent.tagName) >= 0) continue;
    if (parent.closest('[data-xpas]')) continue;
    add(parent, clean(parent.innerText) || txt);
  }
  return { out: out, vw: vw, vh: vh };
})()`

type Collected = { items: ScreenItem[]; area: { x: number; y: number; w: number; h: number }; host: string }

/** Visible, meaningful elements of the page, numbered for matching. Coordinates are viewport pixels. */
export async function items(): Promise<Collected> {
  if (!page) throw new Error('Tarayıcı açık değil.')
  const host = (() => {
    try {
      return new URL(page.url()).host
    } catch {
      return ''
    }
  })()
  const data = (await page.evaluate(COLLECT)) as { out: { text: string; type: string; x: number; y: number; w: number; h: number }[]; vw: number; vh: number }
  const list: ScreenItem[] = data.out.map((d, i) => ({
    id: i + 1,
    text: d.text,
    type: d.type,
    src: 'dom',
    x: d.x,
    y: d.y,
    w: d.w,
    h: d.h,
  }))
  return { items: list, area: { x: 0, y: 0, w: data.vw, h: data.vh }, host }
}

function loc(id: number) {
  if (!page) throw new Error('Tarayıcı açık değil.')
  return page.locator(`[data-xpas="${id}"]`).first()
}

export async function clickItem(id: number, mode: 'left' | 'double' | 'right') {
  await page?.bringToFront()
  const l = loc(id)
  await l.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {})
  await l.click({ button: mode === 'right' ? 'right' : 'left', clickCount: mode === 'double' ? 2 : 1, timeout: 8000 })
}

function pathsIn(text: string): string[] | null {
  const parts = text
    .split(/\r?\n|"\s+"/)
    .map((s) => s.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
  if (!parts.length) return null
  return parts.every((p) => fs.existsSync(p)) ? parts : null
}

/** A file dialog the page opened recently: give it the path instead of typing into the OS dialog. */
export async function feedChooser(text: string): Promise<boolean> {
  if (!chooser || Date.now() - chooser.at > 60000) return false
  const files = pathsIn(text)
  if (!files) return false
  const fc = chooser.fc
  chooser = null
  await fc.setFiles(files)
  log('success', `[tarayıcı] Dosya verildi: ${files.map((f) => path.basename(f)).join(', ')}`)
  return true
}

/** Types into a numbered element. Returns what the field holds afterwards (null if unreadable). */
export async function fillItem(id: number, text: string, clear: boolean, enter: boolean): Promise<string | null> {
  await page?.bringToFront()
  const l = loc(id)
  const info = await l.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: String((el as HTMLInputElement).type || '').toLowerCase() }))
  if (info.tag === 'input' && info.type === 'file') {
    const files = pathsIn(text)
    if (!files) throw new Error(`Dosya bulunamadı: ${text}`)
    await l.setInputFiles(files)
    return text
  }
  const fillable = info.tag === 'textarea' || (info.tag === 'input' && !['button', 'submit', 'checkbox', 'radio'].includes(info.type))
  if (fillable) {
    if (clear) await l.fill(text, { timeout: 8000 })
    else await l.pressSequentially(text, { delay: 15, timeout: 20000 })
    const value = await l.inputValue().catch(() => null)
    if (enter) await l.press('Enter')
    return value
  }
  await l.click({ timeout: 8000 })
  if (clear) {
    await page!.keyboard.press('Control+A')
    await page!.keyboard.press('Delete')
  }
  await page!.keyboard.type(text, { delay: 15 })
  if (enter) await page!.keyboard.press('Enter')
  return null
}

export async function hasText(text: string): Promise<boolean> {
  if (!page) return false
  const q = norm(text)
  if (!q) return false
  try {
    const body = String(await page.evaluate('document.body ? document.body.innerText : ""'))
    return norm(body).includes(q)
  } catch {
    return false
  }
}

export async function pendingDownloads() {
  await Promise.allSettled([...saving])
}
