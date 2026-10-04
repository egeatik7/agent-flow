const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

// Load the actual pure UI helper; no Electron window or copied implementation.
const file = path.join(__dirname, '../src/lib/key-presets.ts')
const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: file,
})
const loaded = new Module(file, module)
loaded._compile(result.outputText, file)
const { KEY_PRESETS, winPrefix } = loaded.exports

test('Win starts a fresh prefix for an empty field or a completed shortcut', () => {
  for (const value of [undefined, '', '   ', 'win+r', 'ctrl+s', '^s', '%{F4}', '+a', '{WIN}']) {
    assert.equal(winPrefix(value), 'win+', String(value))
  }
})

test('Win continues a draft modifier prefix and never duplicates Windows', () => {
  assert.equal(winPrefix('ctrl+'), 'ctrl+win+')
  assert.equal(winPrefix('ctrl+shift+'), 'ctrl+shift+win+')
  assert.equal(winPrefix(' CTRL + '), 'ctrl+win+')
  assert.equal(winPrefix('win+'), 'win+')
  assert.equal(winPrefix(winPrefix('')), 'win+')
  assert.equal(winPrefix('ctrl+win+'), 'ctrl+win+')
  assert.equal(winPrefix('rwin+'), 'rwin+')
})

test('All requested buttons keep their exact labels and new key values', () => {
  assert.deepEqual(KEY_PRESETS.map(({ label, keys }) => [label, keys]), [
    ['Enter', 'enter'], ['Tab', 'tab'], ['Esc', 'esc'],
    ['Ctrl+A', 'ctrl+a'], ['Ctrl+C', 'ctrl+c'], ['Ctrl+V', 'ctrl+v'], ['Ctrl+S', 'ctrl+s'],
    ['Alt+F4', 'alt+f4'], ['Win', 'win+'], ['Win+R', 'win+r'], ['Win+D', 'win+d'],
    ['Win+E', 'win+e'], ['Win+Tab', 'win+tab'], ['F5', 'f5'], ['↓', 'down'], ['↑', 'up'],
  ])
  assert.deepEqual(KEY_PRESETS.filter((preset) => preset.append).map((preset) => preset.label), ['Win'])
})
