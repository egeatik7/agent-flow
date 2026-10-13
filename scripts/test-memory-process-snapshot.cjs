// Run after build:main. Windows-only check of the real production collector, no desktop input.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { OLCUM_BETIGI, psCalistir } = require('../dist-electron/memory-meter.js')

test('native parent PID and actual .NET memory counters reach the collector JSON', { skip: process.platform !== 'win32' }, async () => {
  const { cikti } = await psCalistir(OLCUM_BETIGI, 8000)
  const raw = JSON.parse(cikti.slice(cikti.indexOf('{')))
  assert.ok(Array.isArray(raw.surecler))
  assert.equal(raw.surecAgacHata, '')
  const children = raw.surecler.filter(p => p.parentId === process.pid && p.name.toLowerCase() === 'powershell')
  assert.ok(children.length >= 1, 'the collecting PowerShell must have this Node PID as its parent')
  assert.ok(children.some(p => p.workingSetBayt > 0 && p.privateBayt > 0))
})
