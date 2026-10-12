const { fork } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const test = require('node:test')
const { LibraryStorage } = require('../dist-electron/library-storage.js')
const { initializeLibraryDatabase } = require('../dist-electron/library-database.js')

if (process.argv[2] === '--child') {
  ;(async () => {
    await initializeLibraryDatabase()
    const storage = new LibraryStorage(process.argv[3]), book = storage.load()
    process.on('message', message => {
      if (message === 'claim') {
        try {
          storage.claim()
          const owner = JSON.parse(fs.readFileSync(path.join(storage.directory, '.nubbo-library.lock'), 'utf8'))
          process.send({ event: 'claimed', pid: process.pid, nonce: owner.nonce })
        } catch (e) { process.send({ event: 'rejected', pid: process.pid, message: e.message }) }
      }
      if (message === 'save') {
        try {
          storage.save({ ...book, folders: [{ id: `writer-${process.pid}`, name: `Writer ${process.pid}`, section: 'canvas' }] })
          storage.release(); process.send({ event: 'saved', pid: process.pid }); process.disconnect()
        } catch (e) { process.send({ event: 'error', message: e.message }); process.disconnect() }
      }
      if (message === 'stop') { storage.release(); process.disconnect() }
    })
    process.send({ event: 'ready', pid: process.pid })
  })().catch(e => { process.send({ event: 'error', message: e.message }); process.exitCode = 1; process.disconnect() })
} else {
  function child(directory) {
    const process = fork(__filename, ['--child', directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const messages = [], waiters = []
    let stderr = ''
    process.stderr.on('data', d => { stderr += d })
    process.on('message', message => { messages.push(message); for (const wake of waiters.splice(0)) wake() })
    process.on('exit', () => { for (const wake of waiters.splice(0)) wake() })
    const next = async events => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const index = messages.findIndex(m => events.includes(m.event) || m.event === 'error')
        if (index >= 0) { const [message] = messages.splice(index, 1); assert.notEqual(message.event, 'error', message.message); return message }
        if (process.exitCode !== null || process.signalCode !== null) throw Error(`Child exited: ${stderr}`)
        await new Promise(resolve => { const timer = setTimeout(resolve, 50); waiters.push(() => { clearTimeout(timer); resolve() }) })
      }
      throw Error(`Child timed out: ${stderr}`)
    }
    return { process, next }
  }
  const exit = child => new Promise(resolve => { if (child.process.exitCode !== null || child.process.signalCode !== null) resolve(); else child.process.once('exit', resolve) })

  test('two real processes reclaim a dead writer; exactly one owns and writes the catalog', { timeout: 30_000 }, async () => {
    await initializeLibraryDatabase()
    for (let round = 0; round < 6; round++) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-race-')), children = []
      try {
        const storage = new LibraryStorage(directory); storage.load({ folders: [], canvases: [], automations: [] })
        const previous = child(directory); children.push(previous); await previous.next(['ready']); previous.process.send('claim'); await previous.next(['claimed'])
        previous.process.kill('SIGKILL'); await exit(previous)
        const contenders = [child(directory), child(directory)]; children.push(...contenders)
        await Promise.all(contenders.map(c => c.next(['ready'])))
        for (const c of contenders) c.process.send('claim')
        const results = await Promise.all(contenders.map(c => c.next(['claimed', 'rejected'])))
        assert.equal(results.filter(r => r.event === 'claimed').length, 1, `Round ${round}: two owners or no winner`)
        const winnerIndex = results.findIndex(r => r.event === 'claimed'), winner = contenders[winnerIndex], loser = contenders[1 - winnerIndex]
        const owner = JSON.parse(fs.readFileSync(path.join(directory, '.nubbo-library.lock'), 'utf8'))
        assert.equal(owner.pid, results[winnerIndex].pid); assert.equal(owner.nonce, results[winnerIndex].nonce)
        winner.process.send('save'); await winner.next(['saved']); loser.process.send('stop')
        await Promise.all(contenders.map(exit))
        const library = new LibraryStorage(directory).load()
        assert.equal(library.folders[0].id, `writer-${owner.pid}`)
        assert.equal(fs.existsSync(path.join(directory, '.nubbo-library.lock')), false)
      } finally {
        for (const c of children) if (c.process.exitCode === null && c.process.signalCode === null) c.process.kill('SIGKILL')
        await Promise.all(children.map(exit))
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  })
}
