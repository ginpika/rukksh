import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const dist = path.resolve(process.env.RUKKSH_FRONTEND_DIST || path.join(frontend, 'dist'))
const require = createRequire(path.join(process.env.RUKKSH_PLAYWRIGHT_DIR || frontend, 'package.json'))
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addInitScript(() => {
      localStorage.setItem('rukksh.theme.v4', JSON.stringify({
        v: 4, themeId: 'old', schemeMode: 'light', override: { seed: {} },
        mono: { sidebar: false, hideChrome: false },
      }))
    })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors = [], submissions = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname
      if (url.origin !== 'http://composer-model.test') return route.abort()
      if (!p.startsWith('/api/')) {
        const file = path.resolve(dist, p === '/' ? 'index.html' : '.' + p)
        if (!file.startsWith(dist + path.sep)) return route.abort()
        try { return await route.fulfill({ path: file }) }
        catch { return route.fulfill({ status: 404, body: '' }) }
      }
      const json = value => route.fulfill({ json: value })
      if (p === '/api/auth/me') return json({ id: 'fixture', username: 'fixture', nickname: '验收用户' })
      if (p.includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: '' })
      if (p === '/api/settings') return json({
        models: [{ id: 'env', name: 'DeepSeek', model: 'deepseek-flash', reasoningEfforts: ['low', 'high', 'max'] }],
        defaultModelId: 'env', embedding: { mode: 'llm' }, rerank: { mode: 'off' },
      })
      if (p === '/api/agents/peers') return json([{ id: 'builtin', name: '助手', builtin: true, modelId: null }])
      if (p === '/api/sessions' && request.method() === 'POST') return json({ id: 'fixture-session', agentId: 'builtin', generating: false })
      if (p.endsWith('/live')) return json({ running: false, content: '', trace: [] })
      if (p === '/api/chat/stream') {
        submissions.push(request.postDataJSON())
        return route.fulfill({ contentType: 'text/event-stream', body:
          event('meta', { sessionId: 'fixture-session', messageId: 1 }) +
          event('done', { sessionId: 'fixture-session', messageId: 1, message: '收到', success: true }),
        })
      }
      return json([])
    })
    await page.goto('http://composer-model.test/#/')
    const trigger = page.getByRole('button', { name: /^选择推理强度/ })
    const slider = page.getByRole('slider', { name: '推理强度', exact: true })
    const composer = page.getByRole('textbox', { name: '给 助手 发消息', exact: true })
    await trigger.click()
    await slider.waitFor()
    assert.equal(await slider.isEnabled(), true)

    // Reproduce WebKit's native range press moving focus to its focusable ancestor.
    await page.evaluate(() => {
      document.addEventListener('mousedown', event => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
          document.querySelector('.sl-chat__main').focus({ preventScroll: true })
        }
      })
    })
    const box = await slider.boundingBox()
    const left = box.x + 14, right = box.x + box.width - 14, y = box.y + box.height / 2
    await page.mouse.move(left, y)
    await page.mouse.down()
    assert.equal(await slider.isVisible(), true, 'ancestor focus during a range press must keep the panel open')
    await page.mouse.move(right, y, { steps: 12 })
    await page.mouse.up()
    assert.equal(await slider.inputValue(), '3')
    assert.equal(await slider.getAttribute('aria-valuetext'), '最高')
    await page.mouse.down()
    await page.mouse.move(left, y, { steps: 12 })
    await page.mouse.up()
    assert.equal(await slider.inputValue(), '0')

    // Focus dismissal resumes after release, including keyboard navigation.
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await slider.getAttribute('aria-valuetext'), '低')
    await page.getByRole('button', { name: '恢复默认推理强度', exact: true }).click()
    assert.equal(await slider.inputValue(), '0')
    await slider.focus()
    await composer.focus()
    await slider.waitFor({ state: 'hidden' })

    // A cancelled gesture must also restore focus dismissal.
    await trigger.click()
    await slider.dispatchEvent('pointerdown', { pointerId: 1 })
    await slider.dispatchEvent('pointercancel', { pointerId: 1 })
    await composer.focus()
    await slider.waitFor({ state: 'hidden' })
    await trigger.click()
    await slider.focus()
    await page.keyboard.press('End')
    await page.keyboard.press('Escape')
    await slider.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    await composer.fill('验证本轮推理强度')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByText('收到', { exact: true }).waitFor()
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].reasoningEffort, 'max')
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`${width}px: range drag, WebKit ancestor focus, keyboard, reset, release/cancel dismissal and request effort passed`)
  }
} finally { await browser.close() }
