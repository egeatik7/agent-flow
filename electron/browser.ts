import type { Browser, Page } from 'playwright-core'
import type { ScreenItem } from './matcher'

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

const CDP_URL = 'http://127.0.0.1:9222'
let cdp: Browser | null = null
let cdpFailUntil = 0

/** The Chrome the user opened with --remote-debugging-port=9222. Null when that port is closed. */
export async function attachUserChrome(): Promise<Browser | null> {
  if (cdp?.isConnected()) return cdp
  if (Date.now() < cdpFailUntil) return null
  try {
    const { chromium } = await import('playwright-core')
    cdp = await chromium.connectOverCDP(CDP_URL, { timeout: 700 })
    cdp.on('disconnected', () => {
      cdp = null
    })
    return cdp
  } catch {
    cdp = null
    cdpFailUntil = Date.now() + 12000
    return null
  }
}

type DomBox = { text: string; type: string; x: number; y: number; w: number; h: number }

async function pageOnScreen(p: Page): Promise<DomBox[]> {
  const data = (await p.evaluate(COLLECT)) as { out: { text: string; type: string; x: number; y: number; w: number; h: number }[]; vw: number; vh: number }
  const m = (await p.evaluate(`(() => ({
    sx: window.screenX || 0,
    sy: window.screenY || 0,
    dpr: window.devicePixelRatio || 1,
    top: Math.max(0, (window.outerHeight || 0) - (window.innerHeight || 0))
  }))()`)) as { sx: number; sy: number; dpr: number; top: number }
  const dpr = m.dpr || 1
  const ox = m.sx * dpr
  const oy = (m.sy + m.top) * dpr
  return data.out.map((d) => ({
    text: d.text,
    type: d.type,
    x: ox + d.x * dpr,
    y: oy + d.y * dpr,
    w: d.w * dpr,
    h: d.h * dpr,
  }))
}

function pageMatches(title: string, win: string): boolean {
  const bare = win.replace(/\s+-\s+Google Chrome\s*$/i, '').replace(/\s+-\s+Chromium\s*$/i, '').trim()
  if (!bare || !title) return false
  return bare.includes(title) || title.includes(bare)
}

async function chromeBoxes(win?: string): Promise<DomBox[] | null> {
  const browser = await attachUserChrome()
  if (!browser) return null
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.isClosed())
  if (!pages.length) return null
  let chosen: Page[] = pages
  if (win) {
    const scored: Page[] = []
    for (const p of pages) {
      const title = await p.title().catch(() => '')
      if (pageMatches(title, win)) scored.push(p)
    }
    if (!scored.length) return null
    chosen = scored
  }
  const all: DomBox[] = []
  for (const p of chosen) {
    try {
      all.push(...(await pageOnScreen(p)))
    } catch {
      /* tab gone */
    }
  }
  return all.length ? all : null
}

function asItems(boxes: DomBox[]): ScreenItem[] {
  return boxes.map((d, i) => ({ id: i + 1, text: d.text, type: d.type, src: 'dom' as const, x: d.x, y: d.y, w: d.w, h: d.h }))
}

/** Page elements of the user's Chrome, in screen pixels, for the normal click ladder. */
export async function userChromeItems(win?: string): Promise<{ items: ScreenItem[]; area: { x: number; y: number; w: number; h: number }; host: string } | null> {
  const boxes = await chromeBoxes(win)
  if (!boxes) return null
  const items = asItems(boxes)
  const x1 = Math.min(...items.map((i) => i.x))
  const y1 = Math.min(...items.map((i) => i.y))
  const x2 = Math.max(...items.map((i) => i.x + i.w))
  const y2 = Math.max(...items.map((i) => i.y + i.h))
  return { items, area: { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }, host: 'chrome' }
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return w * h
}

/** The page text sitting on the same spot as a box the user picked on the screen scan. */
export async function matchUserChrome(rect: { x: number; y: number; w: number; h: number }, win?: string): Promise<{ text: string; type: string } | null> {
  const boxes = await chromeBoxes(win)
  if (!boxes) return null
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const inside = boxes.filter((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)
  const pool = inside.length ? inside : boxes.filter((b) => overlap(rect, b) > 0)
  let best: DomBox | null = null
  let score = -1
  for (const b of pool) {
    const area = Math.max(1, b.w * b.h)
    const s = inside.length ? 1 / area : overlap(rect, b) / area
    if (!best || s > score) {
      best = b
      score = s
    }
  }
  if (!best?.text) return null
  return { text: best.text, type: best.type }
}
