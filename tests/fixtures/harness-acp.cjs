// Deterministic external process fixture; no LLM or desktop access.
const readline = require('node:readline')
const scenario = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] || 'complete'
let mcp, turn = 0, rpcId = 0
const sessionId = 'fixture-recovery-session'
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
async function request(method, params) {
  const res = await fetch(mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', ...Object.fromEntries(mcp.headers.map(h => [h.name, h.value])) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`)
  return (await res.json()).result
}
const call = async (name, args = {}) => {
  let result = await request('tools/call', { name, arguments: args })
  while (!result.isError) {
    let ticket
    try { ticket = JSON.parse(result.content?.[0]?.text || '{}') } catch { return result }
    if (!ticket.pending) break
    result = await request('tools/call', { name: 'nubbo_job', arguments: { jobId: ticket.jobId, waitMs: 5000 } })
  }
  return result
}
const details = 'Zaman çizelgesi: başlangıçtaki engel incelendi. Neden: test hedefi kapalıydı. Müdahale: açıldı. Doğrulama: yeni ekranda görüldü. Belirsizlik: yok. Öneri: açılış adımını düzelt.'
async function prompt(id) {
  turn++
  if (scenario === 'nostatus') { send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } }); return }
  await call('nubbo_status')
  const ctx = await call('nubbo_context')
  if (!ctx || ctx.isError) throw new Error('Context missing')
  if (scenario === 'hang') return
  if (scenario === 'orphan') {
    const output = process.argv.find(a => a.startsWith('--orphan-file='))?.slice('--orphan-file='.length)
    const child = require('node:child_process').spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(output)}, 'late-input'), 700)`], { stdio: 'ignore' })
    require('node:fs').writeFileSync(output + '.spawned', String(child.pid))
    process.exit(7)
  }
  if (scenario === 'continue' && turn === 1) { send({ jsonrpc: '2.0', id, result: { stopReason: 'max_tokens' } }); return }
  if (scenario === 'permission') {
    send({ jsonrpc: '2.0', id: 'permission-request', method: 'session/request_permission', params: { sessionId, options: [{ optionId: 'yes', kind: 'allow_once' }] } })
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (['complete', 'drop', 'nodeerror'].includes(scenario)) {
    await call('step_run', { nodeId: 'helper', operationId: 'helper-once' })
    if (scenario === 'drop') process.exit(7)
  }
  if (scenario === 'move-only') await call('step_run', { nodeId: 'target', operationId: 'move-original' })
  if (scenario !== 'noframe') await call('screen_read', scenario === 'all-screen' ? { windowTitle: '' } : {})
  if (scenario === 'failed-refresh') await call('screen_read')
  if (scenario === 'stale-frame') await call('act_key', { keys: 'enter', operationId: 'after-frame' })
  const decision = ['sent-retry', 'move-only'].includes(scenario) ? 'retry' : 'completed'
  const finish = await call('recovery_finish', { operationId: 'finish-once', decision, probableCause: 'Fixture cause', evidence: 'Fresh fixture frame', summary: `Fixture recovered on turn ${turn}`, details })
  if (finish.isError) {
    await call('recovery_finish', { operationId: 'stop-once', decision: 'stop', probableCause: 'Kanıt veya tekrar engeli', evidence: 'Reddedilen karar', summary: 'Fixture rejected completion', details })
  }
  if (scenario === 'finished-hang') return
  if (scenario === 'complete') {
    const late = await call('act_key', { operationId: 'late', keys: 'enter' })
    if (!late.isError) throw new Error('Late action accepted')
  }
  send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const m = JSON.parse(line)
  if (!m.method) { if (m.id === 'permission-request' && m.result?.outcome?.optionId !== 'yes') process.exit(9); return }
  try {
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: scenario !== 'unsupported' } } } })
    else if (m.method === 'session/new') {
      mcp = m.params.mcpServers[0]
      await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })
      const catalog = await request('tools/list', {})
      if (!catalog.tools.find(t => t.name === 'nubbo_status')) throw new Error('MCP tools missing')
      send({ jsonrpc: '2.0', id: m.id, result: { sessionId } })
    } else if (m.method === 'session/prompt') await prompt(m.id)
    else send({ jsonrpc: '2.0', id: m.id, result: {} })
  } catch (error) { send({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: error.message } }) }
})
