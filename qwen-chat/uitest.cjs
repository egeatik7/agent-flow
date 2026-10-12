// Gercek arayuz sinamasi: arayuzu tarayicida acar, mesaj gonderir, gorsel yukler.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();

const OUT = path.join(__dirname, '..', 'test-artifacts');
fs.mkdirSync(OUT, { recursive: true });

// basit test gorseli (kutu + yazi) - PNG el ile uret, kutuphane gerekmesin
function makeTestPng(file) {
  const zlib = require('zlib');
  const W = 360, H = 160;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const border = x < 6 || y < 6 || x > W - 7 || y > H - 7;
      const bar = (y > 60 && y < 100 && x > 40 && x < 300);
      const v = border || bar ? 0 : 255;
      raw[o++] = v; raw[o++] = v; raw[o++] = v;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc);
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return file;
}

(async () => {
  const errors = [];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const R = {};
  try {
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });

    // 1) model listesi ve saglik
    await page.waitForFunction(() => document.querySelectorAll('#model option').length > 0, { timeout: 20000 });
    R.models = await page.$$eval('#model option', os => os.map(o => o.value));
    R.model = await page.$eval('#model', e => e.value);
    R.health = await page.$eval('#htxt', e => e.textContent);
    R.thinkVisible = await page.$eval('#thinkWrap', e => getComputedStyle(e).display !== 'none');
    R.attachEnabled = await page.$eval('#attach', e => !e.disabled);
    await page.screenshot({ path: path.join(OUT, 'ui-1-bos.png') });

    // 2) metin mesaji
    await page.fill('#txt', 'Tek cumleyle kendini tanit.');
    await page.click('#send');
    await page.waitForFunction(() => {
      const b = document.querySelector('.msg.a .bubble');
      return b && b.innerText.trim().length > 5 && !document.querySelector('#stop').offsetParent;
    }, { timeout: 120000 });
    R.cevap1 = (await page.$eval('.msg.a .bubble', e => e.innerText)).trim();
    R.istatistik = await page.$$eval('.msg.a .meta .st', es => es.map(e => e.textContent).filter(Boolean));
    await page.screenshot({ path: path.join(OUT, 'ui-2-metin.png') });

    // 3) gorsel yukleme + vision
    const img = makeTestPng(path.join(OUT, 'test-gorsel.png'));
    await page.setInputFiles('#file', img);
    await page.waitForSelector('#thumbs .th img', { timeout: 20000 });
    R.kucukResim = await page.$eval('#thumbs .th .sz', e => e.textContent);
    await page.fill('#txt', 'Bu gorselde ne var? Tek satirda anlat.');
    await page.click('#send');
    await page.waitForFunction(() => document.querySelectorAll('.msg.a').length >= 2 &&
      document.querySelectorAll('.msg.a')[1].innerText.trim().length > 5 &&
      !document.querySelector('#stop').offsetParent, { timeout: 180000 });
    R.cevap2 = (await page.$$eval('.msg.a .bubble', es => es[1].innerText)).trim();
    R.gorselMesajda = await page.$$eval('.msg.u .imgs img', es => es.length);
    await page.screenshot({ path: path.join(OUT, 'ui-3-gorsel.png') });

    // 4) yenileme sonrasi gecmis
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    R.yenilemeSonrasiMesaj = await page.$$eval('.msg', es => es.length);

    // 5) hata var mi
    R.jsHatalari = errors;
  } catch (e) {
    R.HATA = e.message;
    try { await page.screenshot({ path: path.join(OUT, 'ui-hata.png') }); } catch (_) {}
    R.jsHatalari = errors;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2));
  process.exit(R.HATA || (R.jsHatalari && R.jsHatalari.length) ? 1 : 0);
})();
