const fs = require('node:fs');
const path = require('node:path');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Bounded, developer-only evidence. No global interception and no production settings.
function createTargetRecorder(directory, label = 'target', limit = 80) {
  fs.mkdirSync(directory, { recursive: true });
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'target';
  const prefix = `${safe}-${Date.now()}-${process.pid}`;
  let sequence = 0, events = [], base = '', lastFrame;
  const files = [];
  function save(event) {
    if (event.kind === 'request' || !base) {
      base = `${prefix}-${++sequence}`; events = []; lastFrame = null;
      files.push(base);
      while (files.length > limit) {
        const old = files.shift();
        for (const file of fs.readdirSync(directory).filter(f => f.startsWith(old + '.'))) fs.unlinkSync(path.join(directory, file));
      }
    }
    const copy = structuredClone(event);
    if (copy.scan?.image?.data) {
      const im = copy.scan.image;
      const ext = im.mime === 'image/png' ? 'png' : 'jpg';
      const imageFile = `${base}.frame-${events.length}.${ext}`;
      fs.writeFileSync(path.join(directory, imageFile), Buffer.from(im.data, 'base64'));
      lastFrame = { area: copy.scan.area, items: copy.scan.items, image: im };
      copy.scan.image = { ...im, data: '', artifact: imageFile };
    }
    events.push(copy);
    fs.writeFileSync(path.join(directory, `${base}.trace.json`), JSON.stringify({ version: 1, events }, null, 2));
    if (event.kind === 'resolved' && lastFrame) {
      const { area: a, image: im, items } = lastFrame;
      if (!(a.w > 0 && a.h > 0)) return;
      const sx = im.w / a.w, sy = im.h / a.h;
      const point = event.target;
      const x = (point.x - a.x) * sx, y = (point.y - a.y) * sy;
      const boxes = (items || []).map(r => `<rect x="${(r.x-a.x)*sx}" y="${(r.y-a.y)*sy}" width="${r.w*sx}" height="${r.h*sy}" fill="none" stroke="#00aaff" stroke-width="1"/>`).join('');
      const r = event.rect;
      const selected = r ? `<rect x="${(r.x-a.x)*sx}" y="${(r.y-a.y)*sy}" width="${r.w*sx}" height="${r.h*sy}" fill="none" stroke="#ff2020" stroke-width="3"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${im.w}" height="${im.h+34}" viewBox="0 0 ${im.w} ${im.h+34}"><image width="${im.w}" height="${im.h}" href="data:${im.mime || 'image/jpeg'};base64,${im.data}"/>${boxes}${selected}<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="red" stroke-width="3"/><path d="M ${x-13} ${y} H ${x+13} M ${x} ${y-13} V ${y+13}" stroke="red" stroke-width="2"/><rect y="${im.h}" width="${im.w}" height="34" fill="white"/><text x="8" y="${im.h+23}" font-size="16" fill="black">${escape(event.source + ': ' + point.label + ' @' + point.x + ',' + point.y)}</text></svg>`;
      fs.writeFileSync(path.join(directory, `${base}.overlay.svg`), svg);
    }
  }
  return { save, files: () => files.map(b => path.join(directory, b + '.trace.json')) };
}

function loadTrace(file) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (bundle.version !== 1 || !Array.isArray(bundle.events)) throw new Error('Unsupported target trace');
  for (const e of bundle.events) {
    const image = e.scan?.image;
    if (image?.artifact) {
      if (path.basename(image.artifact) !== image.artifact) throw new Error('Image artifact must be beside the trace');
      image.data = fs.readFileSync(path.join(path.dirname(file), image.artifact)).toString('base64');
    }
  }
  return bundle;
}
module.exports = { createTargetRecorder, loadTrace };
