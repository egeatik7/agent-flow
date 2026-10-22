import path from 'node:path'
import { itemVars, renderTemplate, type AgentGraph } from './graph-types'
import type { CheckpointCursor } from './checkpoint-types'

/**
 * DOSYA TAKİBİ KAPSAMI — izlenecek kökler AKIŞTAN gelir, tüm disklerden değil.
 *
 * Neden: bütün C:\ izlendiğinde tarayıcı önbellekleri, Windows günlükleri ve başka programların
 * dosyaları listeye doluyordu (ölçüm: boşta 1,2 olay/sn, makine meşgulken 34 olay/sn) ve "hangi
 * dosya benim çıktım" sorusu cevaplanamıyordu. Akışın kendi yazdığı klasörler (döngünün `folder`
 * alanı, öğe listesinin ortak klasörü, yazı alanlarındaki yollar) zaten bellidir; izleme onlara
 * bağlanır.
 *
 * Tüm disk izleme isteğe bağlıdır (varsayılan KAPALI) ve ayrı bir bayrakla açılır.
 *
 * Bu modül SAFTIR: dosya sistemine dokunmaz, yalnız yol hesaplar; test edilebilir.
 */

/** Akışta yazılı bir yol ve geldiği alan (kullanıcıya "nereden" bilgisini verebilmek için). */
export type FlowPath = { path: string; source: 'folder' | 'items' | 'text' | 'source' | 'öğe'; label: string }

/** Aynı anda izlenecek en fazla kök: sınır yoksa bir akış yüzlerce klasör yazabilir. */
export const CHECKPOINT_ROOTS_MAX = 24

const DRIVE = /^[A-Za-z]:[\\/]/
const UNC = /^\\\\[^\\/]+[\\/][^\\/]+/
const ABS = new RegExp(`(?:${DRIVE.source}|${UNC.source})`)
const DRIVE_ROOT = /^[A-Za-z]:[\\/]?$/

/** Mutlak mı: Windows sürücü/UNC ya da platformun kendi mutlak yolu (test/taşınabilirlik). */
export function mutlak(p: string): boolean {
  return ABS.test(p) || path.isAbsolute(p)
}

/** `insidePath` burada da gerekir; döngüsel import olmaması için yerel tanım. */
export function icindeMi(parent: string, target: string): boolean {
  const rel = path.relative(parent.toLowerCase(), target.toLowerCase())
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/** Serbest metindeki İLK mutlak yolu çıkarır (tırnak/noktalama temizlenir). */
export function pathInText(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  // 1) Alanın TAMAMI bir yol ise (boşluk içerse bile: "…\ASUS TUF\…\Final Blends") o yoldur.
  const tam = text.replace(/^["']|["']$/g, '').replace(/[.,;:]+$/, '')
  if (tam && ABS.test(tam)) return tam
  // 2) Tırnak içindeki yol boşluk içerebilir.
  const tirnak = text.match(/"([^"]*)"|'([^']*)'/)
  if (tirnak) {
    const ic = (tirnak[1] ?? tirnak[2] ?? '').trim().replace(/[.,;:]+$/, '')
    if (ic && ABS.test(ic)) return ic
  }
  // 3) Tırnaksız ve cümle içinde: boşlukta biter.
  const m = text.match(/(?:[A-Za-z]:[\\/][^\s"'<>|*?]*|\\\\[^\s"'<>|*?]+)/)
  if (!m) return null
  const temiz = m[0].trim().replace(/[.,;:]+$/, '')
  return ABS.test(temiz) ? temiz : null
}

/** Çözülemeyen `{{…}}` kalırsa yolun STATİK ön eki (ör. `C:\Images\{{öğe}}` → `C:\Images`). */
export function staticPrefix(raw: string): string | null {
  const i = raw.indexOf('{{')
  if (i < 0) return raw
  const head = raw.slice(0, i)
  const cut = Math.max(head.lastIndexOf('\\'), head.lastIndexOf('/'))
  return cut > 0 ? head.slice(0, cut) : null
}

/** Dosya gibi mi görünüyor (uzantılı son parça)? Klasörse kendisi, dosyaysa klasörü izlenir. */
export function looksLikeFile(p: string): boolean {
  if (/[\\/]$/.test(p)) return false
  const base = path.basename(p)
  if (!base) return false
  const m = base.match(/\.([A-Za-z0-9]{1,6})$/)
  if (!m) return false
  return !/^\d+$/.test(m[1])
}

/** Verilen yolların ORTAK ÜST klasörü (ör. 20 dosya → tek klasör). Yoksa null. */
export function commonAncestor(paths: string[]): string | null {
  const list = paths.filter(p => typeof p === 'string' && mutlak(p)).map(p => path.resolve(p))
  if (!list.length) return null
  const parcalar = list.map(p => p.split(/[\\/]+/))
  const ortak: string[] = []
  for (let i = 0; i < parcalar[0].length; i++) {
    const parca = parcalar[0][i]
    if (parcalar.every(p => (p[i] ?? '').toLowerCase() === parca.toLowerCase())) ortak.push(parca)
    else break
  }
  const birlesik = ortak.join('\\')
  if (!birlesik) return null
  // Ortak kısım bir DOSYA ise klasörünü al (tek dosyalık liste).
  return looksLikeFile(birlesik) ? path.dirname(birlesik) : birlesik
}

/**
 * İmleçten değişkenler: kapsam değişkenleri + her döngü karesinin O ANKİ öğesi.
 * `itemVars`/`renderTemplate` yürütücüyle AYNI kuralları kullanır ({{öğe}}, {{sıra}}, {{toplam}}).
 */
export function cursorVars(cursor?: CheckpointCursor): Record<string, string> {
  const vars: Record<string, string> = { ...cursor?.files?.vars, sira: '1', toplam: '1' }
  for (const scope of cursor?.scopes ?? []) Object.assign(vars, scope.vars ?? {})
  for (const frame of cursor?.loops ?? []) {
    const key = frame.keys?.[frame.index]
    if (key === undefined) continue
    Object.assign(vars, itemVars(key, frame.index, Math.max(1, frame.keys.length)))
  }
  return vars
}

/** Çıktı OLMAYAN araç dosyaları: bunların klasörü izlenmez (ör. bir .exe yolunu açan node). */
const ARAC_UZANTI = /\.(?:exe|dll|bat|cmd|ps1|lnk|msi|sys)$/i

/** Akıştaki yol taşıyan alanlar (paketlerin içi dâhil). */
export function collectFlowPaths(graph: AgentGraph): FlowPath[] {
  const out: FlowPath[] = []
  const walk = (g: AgentGraph) => {
    for (const n of g.nodes) {
      if (typeof n.folder === 'string' && n.folder.trim()) out.push({ path: n.folder.trim(), source: 'folder', label: n.title })
      // Öğe listesi ÇOĞALTILMAZ: 60 dosya 60 kök demek olurdu. Tek ortak üst klasör yeter.
      const items = (n.items ?? []).filter((x): x is string => typeof x === 'string' && mutlak(x))
      const ortak = commonAncestor(items)
      if (ortak) out.push({ path: ortak, source: 'items', label: n.title })
      // Yazma alanı ve taşıma kaynağı bir yol içerebilir; serbest metinden İLK yolu al.
      // Araç dosyalarının (.exe vb.) klasörü izlenmez: çıktı değildir, boşuna izleyici açardı.
      for (const [field, source] of [['text', 'text'], ['source', 'source']] as const) {
        const value = n[field]
        if (typeof value !== 'string' || !value.includes(':')) continue
        const p = pathInText(value)
        if (p && !ARAC_UZANTI.test(p)) out.push({ path: p, source, label: n.title })
      }
      if (n.inner) walk(n.inner)
    }
  }
  walk(graph)
  return out
}

export type FlowRootSonucu = {
  /** İzlenecek klasörler (iç içe olanlar ayıklandı, sınırlandı). */
  roots: string[]
  /** Kullanılan yol alanları (kullanıcıya kaynak göstermek için). */
  paths: FlowPath[]
  /** Mutlak olmadığı, sistem klasöründe kaldığı ya da sınırı aştığı için atlanan sayısı. */
  skipped: number
}

/**
 * Akış + imleç → izlenecek kökler.
 * Kurallar:
 *  · `{{…}}` imleç değişkenleriyle çözülür; çözülemezse statik ön ek kullanılır.
 *  · Dosya yolu → KLASÖRÜ izlenir. Klasör → kendisi.
 *  · İç içe kökler ayıklanır (üst klasör yeterlidir), en fazla CHECKPOINT_ROOTS_MAX.
 *  · Hariç tutulan köklerin (Nubbo kaydı, Windows, Program Files) içindeki yollar atlanır.
 *  · Disk kökü (`C:\`) tek başına yol olarak atlanır: tüm disk izleme ayrı bir bayraktır.
 */
export function flowRoots(graph: AgentGraph, cursor?: CheckpointCursor, opts?: { max?: number; exclude?: string[] }): FlowRootSonucu {
  const vars = cursorVars(cursor)
  const max = Math.max(1, opts?.max ?? CHECKPOINT_ROOTS_MAX)
  const exclude = (opts?.exclude ?? []).filter(Boolean)
  const paths = collectFlowPaths(graph)
  for (const root of cursor?.files?.roots ?? []) paths.push({ path: root, source: 'folder', label: 'Çalışmanın dosyaları' })
  // Döngünün O ANKİ öğesi de bir klasör olabilir (ör. "…\Remesh Gruplari\01").
  for (const frame of cursor?.loops ?? []) {
    const key = frame.keys?.[frame.index]
    if (typeof key === 'string' && mutlak(key)) paths.push({ path: key, source: 'öğe', label: `${frame.id} · öğe` })
  }

  let skipped = 0
  const adaylar: string[] = []
  for (const entry of paths) {
    const resolved = renderTemplate(entry.path, vars) ?? entry.path
    const statik = staticPrefix(resolved)
    if (!statik) { skipped++; continue }
    const temiz = statik.trim().replace(/^["']|["']$/g, '')
    if (!mutlak(temiz)) { skipped++; continue }
    let p: string
    try { p = path.resolve(temiz) } catch { skipped++; continue }
    if (looksLikeFile(p)) p = path.dirname(p)
    if (DRIVE_ROOT.test(p)) { skipped++; continue }
    if (exclude.some(root => icindeMi(root, p))) { skipped++; continue }
    adaylar.push(p)
  }

  // Kısa (üst) yollar önce gelir: iç içe olan alt yollar ayıklanır.
  const sirali = [...new Set(adaylar)].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const roots: string[] = []
  for (const p of sirali) {
    if (roots.some(root => icindeMi(root, p))) { skipped++; continue }
    if (roots.length >= max) { skipped++; continue }
    roots.push(p)
  }
  return { roots, paths, skipped }
}
