import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const frontend = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(tmpdir())
const output = mkdtempSync(join(root, 'minis-desktop-frame-test-'))
if (dirname(resolve(output)) !== root || !basename(output).startsWith('minis-desktop-frame-test-')) {
  throw new Error('临时测试目录校验失败')
}
after(() => rmSync(output, { recursive: true, force: true }))

try {
  execFileSync(
    process.execPath,
    [
      join(frontend, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--outDir',
      output,
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--resolveJsonModule',
      '--types',
      'vite/client',
      '--jsx',
      'react-jsx',
      '--target',
      'ES2022',
      '--lib',
      'ES2022,DOM',
      '--skipLibCheck',
      '--ignoreDeprecations',
      '6.0',
      'src/shell/DesktopFrame.tsx',
      'src/components/SlimePage.tsx',
      'src/pages/coding/CodingToolbar.tsx',
    ],
    { cwd: frontend, stdio: 'inherit' },
  )
  writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  symlinkSync(join(frontend, 'node_modules'), join(output, 'node_modules'))

  const require = createRequire(join(frontend, 'package.json'))
  const Module = require('node:module')
  const origLoad = Module._load
  Module._load = function (request, ...rest) {
    if (typeof request === 'string' && request.endsWith('.css')) return {}
    const loaded = origLoad.call(this, request, ...rest)
    if (typeof request === 'string' && request.endsWith('/theme/store') && loaded?.getState) {
      return { ...loaded, useThemeState: loaded.getState }
    }
    return loaded
  }
  after(() => {
    Module._load = origLoad
  })
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const buildSrc = join(output, 'frontend/src')
  const { DesktopFrame } = require(join(buildSrc, 'shell/DesktopFrame.js'))
  const SlimePage = require(join(buildSrc, 'components/SlimePage.js')).default
  const CodingToolbar = require(join(buildSrc, 'pages/coding/CodingToolbar.js')).default

  test('standalone content pages drop outer bezel, rail and titlebar slots on desktop', () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      for (const [platform, expectMac] of [['Win32', false], ['MacIntel', true]]) {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: { platform },
        })
        for (const path of ['/', '/dashboard', '/knowledge', '/todos', '/coding']) {
          const html = renderToStaticMarkup(
            React.createElement(
              DesktopFrame,
              {
                hideRail: true,
                activePath: path,
                toolsSlot: React.createElement('span', { 'data-slot': 'tools' }),
                homeSlot: React.createElement('span', { 'data-slot': 'home' }),
                userSlot: React.createElement('span', { 'data-slot': 'user' }),
              },
              React.createElement('div', { 'data-content': path }, 'content'),
            ),
          )
          assert.equal(html.includes('df--frameless'), true, `${platform} ${path}`)
          assert.equal(html.includes('df--mac'), expectMac, `${platform} ${path}`)
          assert.doesNotMatch(html, /df--conversation/, path)
          assert.doesNotMatch(html, /df__acrylic/, path)
          assert.doesNotMatch(html, /df__rail/, path)
          assert.doesNotMatch(html, /data-slot="(?:tools|home|user)"/, path)
          assert.match(html, /class="df__drag"/, path)
          if (expectMac) {
            assert.doesNotMatch(html, /class="df__win"/, `${platform} ${path}`)
            assert.doesNotMatch(html, /class="df__resize"/, `${platform} ${path}`)
          } else {
            assert.match(html, /class="df__win"/, `${platform} ${path}`)
            assert.match(html, /class="df__resize"/, `${platform} ${path}`)
          }
        }
      }
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete globalThis.navigator
    }
  })

  test('legacy shell routes keep desktop rail and titlebar slots', () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      for (const [platform, expectMac] of [['Win32', false], ['MacIntel', true]]) {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: { platform },
        })
        const html = renderToStaticMarkup(
          React.createElement(
            DesktopFrame,
            {
              activePath: '/search',
              toolsSlot: React.createElement('span', { 'data-slot': 'tools' }),
              homeSlot: React.createElement('span', { 'data-slot': 'home' }),
              userSlot: React.createElement('span', { 'data-slot': 'user' }),
            },
            React.createElement('div', null, 'legacy'),
          ),
        )
        assert.doesNotMatch(html, /df--frameless/, platform)
        assert.equal(html.includes('df--mac'), expectMac, platform)
        assert.match(html, /df__acrylic/, platform)
        assert.match(html, /<aside class="df__rail" data-tauri-drag-region="true">/, platform)
        assert.match(html, /data-slot="tools"/, platform)
        assert.match(html, /data-slot="home"/, platform)
        assert.match(html, /data-slot="user"/, platform)
        if (expectMac) {
          assert.doesNotMatch(html, /class="df__win"/, platform)
          assert.doesNotMatch(html, /class="df__resize"/, platform)
        } else {
          assert.match(html, /class="df__win"/, platform)
          assert.match(html, /class="df__resize"/, platform)
        }
      }
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete globalThis.navigator
    }
  })

  test('SlimePage and CodingToolbar expose window drag attributes on headers', () => {
    const pageHtml = renderToStaticMarkup(
      React.createElement(
        SlimePage,
        { title: 'Dashboard', backHref: '#/', backLabel: '回到对话' },
        React.createElement('div', null, 'grid'),
      ),
    )
    assert.match(pageHtml, /<header class="sl-page__header" data-tauri-drag-region="true">/)
    assert.match(pageHtml, /<h1[^>]*data-tauri-drag-region="true">Dashboard<\/h1>/)

    const codingHtml = renderToStaticMarkup(React.createElement(CodingToolbar))
    assert.match(codingHtml, /<header class="coding-toolbar" data-tauri-drag-region="true">/)
    assert.match(codingHtml, /<h1[^>]*data-tauri-drag-region="true">AI IDE<\/h1>/)
  })

  test('frameless CSS clears outer frame and reserves space for Mac and Windows controls', () => {
    const css = readFileSync(join(frontend, 'src/shell/desktopFrame.css'), 'utf8')
    assert.match(css, /\.df--frameless\s*\{\s*--df-pad:\s*0px;\s*--df-gap:\s*0px;/)
    assert.match(css, /\.df--frameless\s+\.df__stage\s*\{\s*border-radius:\s*0;\s*box-shadow:\s*none;/)
    assert.match(css, /--df-edge-line:/)
    assert.match(css, /\.df:not\(\.df--maximized\)::after\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px var\(--df-edge-line\)/)
    assert.match(css, /\.df--frameless:not\(\.df--mac\)\s+\.sl-page__header\s*>\s*\.sl-appearance/)
    assert.match(css, /\.df--frameless:not\(\.df--mac\)\s+\.coding-toolbar/)
    assert.match(css, /\.df--frameless\.df--mac\s+\.sl-page__back/)
    assert.match(css, /\.df--frameless\.df--mac\s+\.coding-toolbar/)
    assert.match(css, /\.df\.df--mac,\s*\.df\.df--mac\s+\.df__acrylic\s*\{\s*border-radius:\s*0;/)
    assert.match(css, /\.df--mac:not\(\.df--frameless\):not\(\.df--fullscreen\)\s+\.df__rail\s*\{\s*padding-top:\s*42px;/)
    assert.match(css, /\.df--frameless\.df--mac\.df--fullscreen\s+\.coding-toolbar/)
    for (const fakeColor of ['#ff5f57', '#febc2e', '#28c840']) {
      assert.equal(css.includes(fakeColor), false, `desktopFrame.css should not draw fake traffic light ${fakeColor}`)
    }

    const pageCss = readFileSync(join(frontend, 'src/components/slimePage.css'), 'utf8')
    assert.match(pageCss, /\.sl-page__header\s*\{[\s\S]*grid-template-columns:\s*minmax\(max-content,\s*1fr\)\s+minmax\(0,\s*auto\)\s+minmax\(max-content,\s*1fr\)/)
    assert.match(pageCss, /\.sl-page__back\s*\{\s*justify-self:\s*end;\s*\}/)

    const app = readFileSync(join(frontend, 'src/App.tsx'), 'utf8')
    assert.match(app, /<DesktopFrame hideRail activePath=\{route\}>/)
  })

  test('index.html first-frame skeleton enables frameless mode for Dashboard and content pages', () => {
    const html = readFileSync(join(frontend, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    const skeletonScript = scripts.at(-1)?.[1]
    assert.ok(skeletonScript)

    const classesFor = (hash, platform) => {
      const classes = new Set()
      const sandbox = {
        window: { __TAURI_INTERNALS__: {}, location: { hash } },
        navigator: platform ? { platform } : undefined,
        document: {
          documentElement: {
            classList: {
              add: (...names) => names.forEach((n) => classes.add(n)),
              remove: (...names) => names.forEach((n) => classes.delete(n)),
            },
          },
          getElementById: () => null,
        },
        setTimeout: () => 0,
      }
      vm.runInNewContext(skeletonScript, sandbox)
      return classes
    }

    const homeClasses = classesFor('#/')
    assert.equal(homeClasses.has('minis-df-frameless'), true)
    assert.equal(homeClasses.has('minis-df-conversation'), true)
    assert.equal(homeClasses.has('minis-df-mac'), false)

    const macHomeClasses = classesFor('#/', 'MacIntel')
    assert.equal(macHomeClasses.has('minis-df-mac'), true)
    assert.equal(macHomeClasses.has('minis-df-frameless'), true)
    assert.equal(macHomeClasses.has('minis-df-conversation'), true)

    for (const hash of ['#/dashboard', '#/coding', '#/knowledge', '#/todos', '#/memory', '#/article/1']) {
      const classes = classesFor(hash)
      assert.equal(classes.has('minis-df-skeleton'), true, hash)
      assert.equal(classes.has('minis-df-frameless'), true, hash)
      assert.equal(classes.has('minis-df-conversation'), false, hash)
    }

    for (const hash of ['#/search?q=test', '#/memory/ops']) {
      const classes = classesFor(hash)
      assert.equal(classes.has('minis-df-skeleton'), true, hash)
      assert.equal(classes.has('minis-df-frameless'), false, hash)
      assert.equal(classes.has('minis-df-conversation'), false, hash)
    }
  })
} catch (error) {
  rmSync(output, { recursive: true, force: true })
  throw error
}
