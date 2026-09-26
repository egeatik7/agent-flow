export type A11yDecision = {
  name: string
  controlType: string
  path: string
  reason: string
}

type TreeNode = {
  id: string
  name: string
  controlType: string
  automationId?: string
  path: string
  children?: TreeNode[]
}

function flattenTree(node: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  acc.push({
    id: node.id,
    name: node.name,
    controlType: node.controlType,
    automationId: node.automationId,
    path: node.path,
  })
  for (const c of node.children || []) flattenTree(c, acc)
  return acc
}

export async function runOpenRouterAgentStep(opts: {
  apiKey: string
  model: string
  prompt: string
  tree: TreeNode
  stageTitle?: string
  stageIndex: number
}): Promise<A11yDecision> {
  const flat = flattenTree(opts.tree).slice(0, 400)
  const catalog = flat.map((n, i) => ({
    i,
    name: n.name,
    controlType: n.controlType,
    automationId: n.automationId || '',
    path: n.path,
  }))

  const system = `Sen bir Windows UI Automation ajanısın. Kullanıcının aşama promptuna göre accessibility tree içinden tıklanacak tek öğeyi seç.
Yanıtını SADECE geçerli JSON olarak ver:
{"index":number,"name":string,"controlType":string,"path":string,"reason":string}
index, sana verilen katalogdaki i alanıdır. path alanını katalogdan birebir kopyala.`

  const user = `Aşama ${opts.stageIndex}${opts.stageTitle ? ` — ${opts.stageTitle}` : ''}
Prompt: ${opts.prompt}

Accessibility katalog (JSON):
${JSON.stringify(catalog)}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://xp-agent-studio.local',
      'X-Title': 'XP Agent Studio',
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content || '{}'
  let parsed: {
    index?: number
    name?: string
    controlType?: string
    path?: string
    reason?: string
  }
  try {
    parsed = JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : {}
  }

  const byIndex =
    typeof parsed.index === 'number' ? catalog[parsed.index] : undefined
  const byPath = parsed.path
    ? catalog.find((c) => c.path === parsed.path)
    : undefined
  const hit = byPath || byIndex

  if (!hit) {
    throw new Error('LLM geçerli bir accessibility öğesi seçmedi.')
  }

  return {
    name: hit.name || parsed.name || '',
    controlType: hit.controlType || parsed.controlType || '',
    path: hit.path,
    reason: parsed.reason || 'seçildi',
  }
}
