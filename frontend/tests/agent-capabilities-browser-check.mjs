import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(frontend, 'dist')
const output = path.resolve(frontend, '../backend/target/agent-capabilities-browser-check')
await fs.mkdir(output, { recursive: true })
const require = createRequire(path.join(process.env.RUKKSH_PLAYWRIGHT_DIR || frontend, 'package.json'))
const { chromium } = require('playwright')
const peers = ['builtin', 'member'].map((id, sort) => ({
  id, sort, name: ['核心助手', '专业成员'][sort], builtin: id !== 'member',
  terminals: id === 'member' ? ['one'] : [], modelId: null, avatar: null, note: null, role: null, roleColor: null,
  executionKind: 'CHAT',
}))
const targets = [{ id: 'one', name: '开发环境', kind: 'ssh', enabled: true }, { id: 'new', name: '新增环境', kind: 'docker', enabled: false }]
const recalls = [
  { id: 1, channel: 'memory', tool: 'memory_inject', source: 'chat', query: '项目交付偏好', result: '交付前核对改动、验证结果和待跟进事项。' },
  { id: 2, channel: 'vector', tool: 'search_vector_chunks', source: 'plan', query: '项目验收记录', result: '本周待审阅的工作项已汇总到项目记录。' },
].map(row => ({ ...row, agentId: 'builtin', createdAt: Date.UTC(2026, 10, 19, 2, 0), resultChars: row.result.length }))
const creates = [], saves = [], errors = []
let terminalRequests = 0
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    window.__RUKKSH_LOCAL_TOKEN__ = 'fixture-desktop-token'
    localStorage.setItem('rukksh.theme.v4', JSON.stringify({ v: 4, themeId: 'old', schemeMode: 'light', override: { seed: {} }, mono: { sidebar: false, hideChrome: false } }))
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== 'http://agent-capabilities.test') return route.abort()
    if (!url.pathname.startsWith('/api/')) {
      const file = path.resolve(dist, url.pathname === '/' ? 'index.html' : '.' + url.pathname)
      if (!file.startsWith(dist + path.sep)) return route.abort()
      try { return await route.fulfill({ path: file }) } catch { return route.fulfill({ status: 404, body: '' }) }
    }
    const json = value => route.fulfill({ json: value })
    if (url.pathname === '/api/auth/me') return json({ id: 'fixture', username: 'fixture', nickname: '验收用户', role: 'user' })
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: '' })
    if (url.pathname === '/api/sessions') return json([{ id: 'fixture-session', title: '聊天入口验收', generating: false }])
    if (url.pathname === '/api/settings') return json({ models: [], embedding: { mode: 'llm' }, rerank: { mode: 'off' } })
    if (url.pathname === '/api/terminal') {
      terminalRequests++
      return json({ targets })
    }
    if (url.pathname === '/api/agents/peers' && req.method() === 'POST') {
      const body = req.postDataJSON()
      creates.push(body)
      const created = { ...body, id: 'created', sort: peers.length, builtin: false, terminals: [], executionKind: 'CHAT' }
      peers.push(created)
      return json(created)
    }
    if (url.pathname === '/api/agents/peers') return json(peers)
    if (url.pathname === '/api/settings/tts') return json({ endpoints: [], profiles: [], defaultProfileId: null })
    if (url.pathname.endsWith('/tts')) return json({ profileId: null })
    if (url.pathname.endsWith('/heartbeat')) return json({ enabled: true, tickMs: 60000, content: '检查常驻职责的运行状态。', modelId: null })
    if (url.pathname.endsWith('/pulse')) return json({ heartbeats: [] })
    if (url.pathname.endsWith('/resources')) return json({ planUsage: [] })
    if (url.pathname === '/api/agents/builtin/plans') return json([{ id: 'weekly', name: '检查项目进度', enabled: true, intervalMs: 3600000, channels: ['silent'], tools: ['recall_memory'], content: '汇总项目中需要跟进的事项。' }])
    if (url.pathname === '/api/agents/builtin/rag-recalls') return json(recalls.filter(row => !url.searchParams.has('channel') || row.channel === url.searchParams.get('channel')))
    if (url.pathname.endsWith('/anchor')) return json({ anchor: null, graph: { nodes: [], edges: [] } })
    if (url.pathname === '/api/coding/capabilities') return json({ enabled: true, agent: peers.find(p => p.id === 'builtin') })
    if (url.pathname === '/api/coding/projects') return json([{ id: 'p1', name: '角色配置验收', workspaceId: 'one', workspaceName: '开发环境', directory: '.', kind: 'ssh', enabled: true }])
    if (url.pathname.endsWith('/files')) return json({ entries: [], path: '.' })
    if (url.pathname.endsWith('/prompts')) return json({ categories: [
      { key: 'chat', name: '对话', description: '用于这位智能体的日常对话。', contexts: [{
        key: 'chat', name: '系统提示词', description: '模型按以下顺序读取提示词。', runtime: [{ key: 'memory', name: '记忆与资料', description: '对话时按需填入。' }],
        parts: ['身份与职责', '上下文增强', '工具使用约定'].map((name, index) => ({ key: `prompt_${index}`, name, description: '', builtin: '示例提示词', builtinSource: 'code', versions: [] })),
      }] },
      ...(url.pathname.includes('/builtin/') ? [{ key: 'skills', name: 'Skills · 状态化提示词', description: '仅在编程 IDE 中启用。', contexts: [{ key: 'ide', name: '编程 IDE', description: '普通聊天不加载。', parts: [{ key: 'coding_skill', name: '编程 Skill', description: 'IDE 状态规程', builtin: '保留调查、实施、验证与交付规程。', builtinSource: 'code', versions: [] }], runtime: [] }] }] : []),
    ] })
    if (req.method() === 'PUT' && url.pathname.startsWith('/api/agents/peers/')) {
      const id = url.pathname.split('/').at(-1), body = req.postDataJSON()
      saves.push({ id, body }); Object.assign(peers.find(p => p.id === id), body)
      return json(peers.find(p => p.id === id))
    }
    return json([])
  })
  const open = async id => {
    await page.goto(`http://agent-capabilities.test/#/multi-agent/${id}`)
    await page.getByRole('heading', { name: peers.find(p => p.id === (id === 'builtin-coding' ? 'builtin' : id)).name, exact: true }).waitFor()
  }
  const mainTabs = page.getByRole('tablist', { name: '配置分类' })
  const memberTabs = ['提示词', '语音', '后台运行', '图谱锚点']
  await open('builtin')
  assert.deepEqual(await mainTabs.getByRole('tab').allTextContents(), [...memberTabs, '编程任务'])
  await page.getByRole('heading', { name: '提示词与上下文' }).waitFor()
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('「核心助手」的资料已保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭通知' }).click()
  assert.equal(Object.hasOwn(saves.at(-1).body, 'tools'), false)
  assert.equal(Object.hasOwn(saves.at(-1).body, 'terminals'), false)
  const runtime = mainTabs.getByRole('tab', { name: '后台运行' })
  await runtime.click()
  const runtimeTabs = page.getByRole('tablist', { name: '后台运行' })
  assert.deepEqual(await runtimeTabs.getByRole('tab').allTextContents(), ['心跳', '常驻职责', '行动日志', 'RAG 召回'])
  await page.getByRole('heading', { name: '心跳', exact: true }).waitFor()
  await runtimeTabs.getByRole('tab', { name: '心跳', exact: true }).focus()
  await page.keyboard.press('End')
  await page.getByRole('heading', { name: 'RAG 召回', exact: true }).waitFor()
  assert.equal(await runtimeTabs.getByRole('tab', { name: 'RAG 召回' }).getAttribute('aria-selected'), 'true')
  await mainTabs.getByRole('tab', { name: '语音', exact: true }).click()
  await page.getByRole('heading', { name: '语音配置', exact: true }).waitFor()
  assert.equal(await runtimeTabs.count(), 0)
  await runtime.click()
  await page.getByRole('heading', { name: 'RAG 召回', exact: true }).waitFor()
  await page.getByText('项目交付偏好', { exact: true }).waitFor()
  await page.getByRole('button', { name: /切换为深色/ }).click()
  await page.screenshot({ path: path.join(output, 'runtime-1440-dark.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 780 })
  for (const item of ['心跳', '常驻职责', '行动日志', 'RAG 召回']) {
    await runtimeTabs.getByRole('tab', { name: item }).click()
    if (item === '心跳') await page.getByRole('button', { name: '敲一次', exact: true }).waitFor()
    if (item === '常驻职责') await page.getByText('检查项目进度', { exact: true }).waitFor()
    if (item === 'RAG 召回') await page.getByText('项目交付偏好', { exact: true }).waitFor()
    assert.ok(await page.locator('.sl-page__main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `overflow on ${item}`)
  }
  await page.getByRole('button', { name: /切换为跟随系统/ }).click()
  await page.getByRole('button', { name: /切换为浅色/ }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mainTabs.getByRole('tab', { name: '图谱锚点' }).click()
  await page.getByRole('button', { name: '新建图谱人格锚点' }).waitFor()
  await mainTabs.getByRole('tab', { name: '编程任务' }).click()
  await page.getByRole('heading', { name: '我的编码任务' }).waitFor()
  await mainTabs.getByRole('tab', { name: '提示词', exact: true }).click()
  await page.getByText('身份与职责', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'prompt-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileProfile = page.getByRole('button', { name: '成员资料' })
  assert.equal(await mobileProfile.getAttribute('aria-expanded'), 'false')
  assert.ok(!(await page.getByRole('textbox', { name: /^名字/ }).isVisible()))
  await mobileProfile.click()
  assert.ok(await page.getByRole('textbox', { name: /^名字/ }).isVisible())
  await mobileProfile.click()
  assert.ok(await page.locator('.sl-page__main').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  await page.screenshot({ path: path.join(output, 'prompt-390.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open('member')
  assert.deepEqual(await mainTabs.getByRole('tab').allTextContents(), memberTabs)
  await page.getByRole('textbox', { name: '备注', exact: true }).fill('负责验收工作')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('「专业成员」的资料已保存', { exact: true }).waitFor()
  assert.equal(Object.hasOwn(saves.at(-1).body, 'tools'), false)
  assert.equal(Object.hasOwn(saves.at(-1).body, 'terminals'), false)
  assert.deepEqual(peers.find(peer => peer.id === 'member').terminals, ['one'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://agent-capabilities.test/#/multi-agent/new')
  await page.getByRole('heading', { name: '成员资料' }).waitFor()
  assert.equal(await mainTabs.count(), 0)
  await page.getByRole('textbox', { name: /^名字/ }).fill('新建验收成员')
  await page.getByRole('button', { name: '加入圆桌' }).click()
  await page.waitForURL('**/#/multi-agent/created')
  await page.getByRole('heading', { name: '提示词与上下文' }).waitFor()
  assert.equal(Object.hasOwn(creates.at(-1), 'terminals'), false)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open('builtin-coding')
  assert.deepEqual(await mainTabs.getByRole('tab').allTextContents(), [...memberTabs, '编程任务'])
  assert.equal(terminalRequests, 0)

  await page.goto('http://agent-capabilities.test/#/')
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await page.getByRole('button', { name: '聊天入口验收', exact: true }).click()
  const settingsLink = page.getByRole('link', { name: '智能体设置', exact: true })
  await settingsLink.click()
  await page.waitForURL('**/#/multi-agent/builtin')
  await page.getByRole('heading', { name: '提示词与上下文' }).waitFor()

  await page.goto('http://agent-capabilities.test/#/coding?project=p1')
  await page.getByRole('link', { name: '编辑核心助手的头像、名字与人设', exact: true }).click()
  await page.getByRole('heading', { name: '核心助手', exact: true }).waitFor()
  await page.getByRole('tab', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: 'Skills · 状态化提示词', exact: true }).click()
  await page.getByText('编程 Skill', { exact: true }).waitFor()
  await page.getByText('普通聊天不加载。', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: /^名字/ }).fill('牧濑红莉栖')
  await page.locator('input[type=file]').setInputFiles({ name: 'character.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: '移除', exact: true }).waitFor()
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('「牧濑红莉栖」的资料已保存', { exact: true }).waitFor()
  assert.equal(saves.at(-1).body.name, '牧濑红莉栖')
  assert.ok(saves.at(-1).body.avatar.startsWith('data:image/jpeg;base64,'))
  const savedAvatar = saves.at(-1).body.avatar
  await page.getByRole('link', { name: '编程工作台', exact: true }).click()
  const profileLink = page.getByRole('link', { name: '编辑牧濑红莉栖的头像、名字与人设', exact: true })
  await profileLink.waitFor()
  assert.equal(await profileLink.locator('img').getAttribute('src'), savedAvatar)
  await page.reload()
  await profileLink.waitFor()
  assert.equal(await profileLink.locator('img').getAttribute('src'), savedAvatar)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await profileLink.isVisible())
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `profile overflow at ${width}px`)
    await page.screenshot({ path: path.join(output, `coding-profile-${width}.png`), fullPage: true })
  }
  // An explicit empty project opens the start page instead of the remembered project.
  await page.goto('http://agent-capabilities.test/#/coding?project=')
  await profileLink.waitFor()
  assert.equal(await profileLink.locator('img').getAttribute('src'), savedAvatar)
  await profileLink.click()
  await page.getByRole('button', { name: '成员资料' }).click()
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('「牧濑红莉栖」的资料已保存', { exact: true }).waitFor()
  assert.equal(saves.at(-1).body.avatar, '')
  await page.getByRole('link', { name: '编程工作台', exact: true }).click()
  await profileLink.waitFor()
  assert.equal(await profileLink.locator('img').count(), 0)
  assert.equal(await profileLink.locator('.coding-agent-name').textContent(), '牧濑红莉栖')
  assert.deepEqual(errors, [])
  console.log('Agent detail: current tabs, keyboard navigation, responsive layout, profile creation and coding profile flows passed.')
} finally {
  await browser.close()
}
