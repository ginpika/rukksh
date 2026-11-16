import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DESKTOP_DIR = path.join(ROOT, 'desktop')
const UI_HTML = path.join(DESKTOP_DIR, 'ui', 'index.html')

function readUtf8(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

function makeClassList(initial = []) {
  const set = new Set(initial)
  return {
    add(...names) {
      for (const n of names) if (n) set.add(n)
    },
    remove(...names) {
      for (const n of names) set.delete(n)
    },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) {
          set.delete(name)
          return false
        }
        set.add(name)
        return true
      }
      if (force) set.add(name)
      else set.delete(name)
      return Boolean(force)
    },
    contains(name) {
      return set.has(name)
    },
    toString() {
      return [...set].join(' ')
    },
  }
}

function makeEl(tag = 'div', id = '') {
  const attrs = new Map()
  const listeners = new Map()
  let text = ''
  const el = {
    tagName: tag.toUpperCase(),
    id,
    value: '',
    disabled: false,
    hidden: false,
    focused: false,
    title: '',
    type: '',
    placeholder: '',
    alt: '',
    src: '',
    href: '',
    files: [],
    dataset: {},
    style: {},
    className: '',
    children: [],
    parentNode: null,
    classList: makeClassList(),
    set textContent(v) {
      text = v === null || v === undefined ? '' : String(v)
      if (text === '') el.children = []
    },
    get textContent() {
      if (text) return text
      return el.children.map((c) => c.textContent).join('')
    },
    setAttribute(k, v) {
      attrs.set(k, String(v))
      if (k === 'class') el.className = String(v)
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k) : null
    },
    appendChild(child) {
      child.parentNode = el
      el.children.push(child)
      return child
    },
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') text += n
        else el.appendChild(n)
      }
    },
    remove() {
      if (!el.parentNode) return
      el.parentNode.children = el.parentNode.children.filter((c) => c !== el)
      el.parentNode = null
    },
    contains(target) {
      if (!target) return false
      if (target === el) return true
      return el.children.some((c) => c.contains(target))
    },
    focus() {
      el.focused = true
    },
    click() {
      return el.dispatchEvent('click', { target: el })
    },
    querySelector(sel) {
      if (sel === 'use') {
        if (!el._use) {
          el._use = makeEl('use')
          el.appendChild(el._use)
        }
        return el._use
      }
      return null
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    dispatchEvent(type, extra = {}) {
      const event = {
        type,
        target: extra.target || el,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
        stopPropagation() {},
        ...extra,
      }
      const list = listeners.get(type) || []
      const results = list.map((fn) => fn(event))
      return Promise.all(results)
    },
  }
  return el
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function runLauncherSandbox({
  brand = { name: 'Slime', tagline: 'Minimal Launcher', slug: 'slime' },
  initialScheme = 'system',
  prefersDark = false,
  platform = 'MacIntel',
  invokeHandler,
} = {}) {
  const html = fs.readFileSync(UI_HTML, 'utf8')
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.ok(scripts.length >= 3, 'expected brand, early theme, and launcher scripts in index.html')

  const elements = new Map()
  const queriedIds = [
    'brand-name',
    'brand-tagline',
    'remote-url',
    'appearance-btn',
    'appearance-icon',
    'win-max-icon',
    'win-min',
    'win-max',
    'win-close',
    'toasts',
    'account-dock',
    'account-btn',
    'account-btn-avatar',
    'account-dot',
    'account-panel',
    'launch-stage',
    'remote-expand',
    'detail',
    'remote-form',
    'choose-local',
    'open-remote',
    'remote-back',
    'choose-remote',
    'remote-tag',
    'veil',
    'login-hostid',
    'login-hostid-hint',
    'remote-hosts',
    'user-ids',
    'local-name',
    'hostid-url',
    'hostid-form',
    'pick-avatar',
    'pick-avatar-btn',
    'avatar-file',
    'avatar-clear',
    'sso-profile',
    'sso-host',
    'sso-badge',
    'save-local',
    'logout-sso',
    'session-banner',
    'session-dismiss',
    'session-relogin',
  ]
  for (const id of queriedIds) {
    const el = makeEl('div', id)
    if (id === 'account-panel' || id === 'session-banner' || id === 'sso-profile' || id === 'remote-tag') {
      el.hidden = true
    }
    if (id === 'remote-expand') el.setAttribute('aria-hidden', 'true')
    if (id === 'account-btn') el.setAttribute('aria-expanded', 'false')
    elements.set(id, el)
  }

  // Wire dock containment for outside-click test.
  const accountDock = elements.get('account-dock')
  accountDock.appendChild(elements.get('account-btn'))
  accountDock.appendChild(elements.get('account-panel'))

  const outsideEl = makeEl('main', 'outside')

  const storage = new Map()
  if (initialScheme) storage.set('minis.shell.scheme', initialScheme)

  const docListeners = new Map()
  const documentMock = {
    title: '',
    documentElement: {
      dataset: {},
      style: {},
    },
    body: {
      dataset: { phase: 'idle' },
      classList: makeClassList(),
    },
    getElementById(id) {
      return elements.get(id) || null
    },
    createElement(tag) {
      return makeEl(tag)
    },
    querySelectorAll(sel) {
      if (sel === '#rz i') return []
      return []
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, [])
      docListeners.get(type).push(fn)
    },
    async dispatchEvent(type, eventInit = {}) {
      const ev = {
        type,
        target: outsideEl,
        preventDefault() {},
        ...eventInit,
      }
      for (const fn of docListeners.get(type) || []) {
        await fn(ev)
      }
    },
  }

  const invokes = []
  const tauriListeners = new Map()

  const windowListeners = new Map()
  const windowMock = {
    __BRAND__: brand,
    navigator: { platform },
    document: documentMock,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      if (!windowListeners.has(type)) return
      windowListeners.set(
        type,
        windowListeners.get(type).filter((f) => f !== fn),
      )
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: () => {},
    }),
    requestAnimationFrame: (fn) => fn(),
    URL,
    Image: class {},
    FileReader: class {},
    __TAURI__: {
      core: {
        invoke: async (cmd, args = {}) => {
          invokes.push({ cmd, args })
          return invokeHandler ? invokeHandler(cmd, args) : null
        },
      },
      event: {
        listen: async (name, cb) => {
          tauriListeners.set(name, cb)
          return () => tauriListeners.delete(name)
        },
      },
      window: {
        getCurrentWindow: () => ({
          isMaximized: async () => false,
          minimize: async () => {},
          toggleMaximize: async () => {},
          close: async () => {},
          startDragging: async () => {},
          startResizeDragging: async () => {},
        }),
      },
    },
  }

  const ctx = vm.createContext({
    ...windowMock,
    window: null,
    console,
    setTimeout,
    clearTimeout,
  })
  ctx.window = ctx

  for (const script of scripts) {
    new vm.Script(script).runInContext(ctx)
  }

  return {
    el: (id) => elements.get(id),
    outsideEl,
    doc: documentMock,
    storage,
    invokes,
    emitTauri: (name, payload) => tauriListeners.get(name)?.({ payload }),
  }
}

test('mail adaptation and legacy shell artifacts are completely removed', () => {
  for (const rel of [
    'desktop/src/mail_appearance.rs',
    'desktop/ui/mail-appearance.js',
    'desktop/tests/mail-appearance.test.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `${rel} should be removed`)
  }

  const cargoToml = readUtf8('desktop/Cargo.toml')
  const configRs = readUtf8('desktop/src/config.rs')
  const mainRs = readUtf8('desktop/src/main.rs')
  const indexHtml = readUtf8('desktop/ui/index.html')

  assert.equal(cargoToml.includes('unstable'), false, 'desktop/Cargo.toml should not enable tauri unstable feature')
  assert.equal(configRs.includes('mail_url'), false, 'config.rs should not have mail_url')

  for (const removedSymbol of ['mail_appearance', 'MAIL_WEBVIEW', 'desktop_save_mail_url', 'desktop_show_mail']) {
    assert.equal(mainRs.includes(removedSymbol), false, `main.rs should not contain ${removedSymbol}`)
  }

  for (const removedUi of [
    'mail-appearance',
    'desktop_show_mail',
    'desktop_save_mail_url',
    'nav-rail',
    '#about',
    'user-chip',
    'acrylic',
  ]) {
    assert.equal(indexHtml.includes(removedUi), false, `index.html should not contain legacy/mail token ${removedUi}`)
  }
})

test('shell UI uses Slime minimalist v2 structure, tokens, icons, and assets', () => {
  const indexHtml = readUtf8('desktop/ui/index.html')
  for (const required of [
    '--sl-bg',
    '--sl-accent',
    'data-scheme',
    'is-mac',
    '[hidden] {\n        display: none !important;\n      }',
    'id="launch-stage"',
    'id="choose-local"',
    'id="open-remote"',
    'id="remote-expand"',
    'id="remote-back"',
    'id="account-dock"',
    'id="account-btn"',
    'id="account-panel"',
    'id="user-ids"',
    'id="sso-profile"',
    'id="sso-host"',
    'id="logout-sso"',
    'id="hostid-form"',
    'class="win-controls"',
    'id="rz"',
  ]) {
    assert.ok(indexHtml.includes(required), `index.html missing expected marker: ${required}`)
  }

  // No duplicate full SSO avatar card inside HostID section.
  assert.equal(indexHtml.includes('id="sso-avatar"'), false)
  assert.equal(indexHtml.includes('id="sso-name"'), false)

  const sprite = readUtf8('desktop/ui/lucide.svg')
  for (const iconId of [
    'arrow-left',
    'appearance-system',
    'appearance-light',
    'appearance-dark',
    'minimize',
    'maximize',
    'restore',
    'close',
  ]) {
    assert.ok(sprite.includes(`id="${iconId}"`), `lucide.svg missing symbol ${iconId}`)
  }

  for (const iconFile of ['icon-64x64.png', 'icon-128x128.png']) {
    const desktopBuf = fs.readFileSync(path.join(DESKTOP_DIR, 'ui', iconFile))
    const frontendBuf = fs.readFileSync(path.join(ROOT, 'frontend', 'public', iconFile))
    assert.equal(desktopBuf.equals(frontendBuf), true, `${iconFile} should match frontend/public/${iconFile}`)
  }

  // macOS uses native Tauri decorations + overlay titlebar + Unified toolbar traffic lights
  // instead of hand-drawn CSS traffic light buttons.
  const mainRs = readUtf8('desktop/src/main.rs')
  assert.ok(mainRs.includes('.decorations(cfg!(target_os = "macos"))'))
  assert.ok(mainRs.includes('.transparent(!cfg!(target_os = "macos"))'))
  assert.ok(mainRs.includes('tauri::TitleBarStyle::Overlay'))
  assert.ok(mainRs.includes('.hidden_title(true)'))
  assert.ok(mainRs.includes('NSWindowToolbarStyle::Unified'))

  for (const legacyColor of ['#ff5f57', '#febc2e', '#28c840']) {
    assert.equal(indexHtml.includes(legacyColor), false, `index.html should not draw fake traffic light ${legacyColor}`)
  }
  assert.match(indexHtml, /body\.is-mac\s+#rz[\s\S]*body\.is-mac\s+\.win-controls\s*\{[\s\S]*display:\s*none/)
})

test('launcher v2 UI handles remote expand/collapse, account popover, identity switch, and theme cycling', async () => {
  let state = {
    mode: 'local',
    remoteBaseUrl: 'https://api.slime.example.com',
    phase: 'idle',
    detail: '',
    sessionExpired: false,
    instance: null,
  }
  let users = {
    current: 'sso',
    local: { name: '本地用户', avatar: '' },
    sso: { name: 'Ginpika', avatar: '', email: 'ginpika@ginpika.cc' },
  }

  const sandbox = runLauncherSandbox({
    initialScheme: 'system',
    prefersDark: false,
    invokeHandler: async (cmd, args) => {
      if (cmd === 'desktop_state') return state
      if (cmd === 'desktop_users') return users
      if (cmd === 'desktop_hostid_base') return 'https://mail.ginpika.cc'
      if (cmd === 'desktop_switch_user') {
        users = { ...users, current: args.kind }
        return users
      }
      return null
    },
  })

  await flushMicrotasks()

  // Branding + initial minimal 2-button stage
  assert.equal(sandbox.doc.title, 'Slime')
  assert.equal(sandbox.el('brand-name').textContent, 'Slime')
  assert.equal(sandbox.el('remote-url').placeholder, 'https://slime.example.com')
  assert.equal(sandbox.doc.body.classList.contains('is-mac'), true)
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), false)
  assert.equal(sandbox.el('remote-expand').getAttribute('aria-hidden'), 'true')
  assert.equal(sandbox.el('account-panel').hidden, true)

  // Bottom-left account trigger shows SSO initial + dot
  assert.equal(sandbox.el('account-btn-avatar').textContent, 'G')
  assert.equal(sandbox.el('account-dot').hidden, false)
  assert.equal(sandbox.el('account-dot').className, 'account-dot')

  // Theme cycling: system -> light -> dark -> system (syncs native window theme on macOS)
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'system')
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'plugin:window|is_fullscreen'),
    'macOS launcher should query native fullscreen state',
  )
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_theme' && c.args.value === null),
    'system mode should sync null window theme on macOS',
  )
  await sandbox.el('appearance-btn').click()
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'light')
  assert.equal(sandbox.el('appearance-icon').getAttribute('href'), 'lucide.svg#appearance-light')
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_theme' && c.args.value === 'light'),
  )
  await sandbox.el('appearance-btn').click()
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'dark')
  assert.equal(sandbox.el('appearance-icon').getAttribute('href'), 'lucide.svg#appearance-dark')
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_theme' && c.args.value === 'dark'),
  )
  await sandbox.el('appearance-btn').click()
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'system')

  // Clicking 启动远程后端 expands remote card and hides local button stage
  await sandbox.el('open-remote').click()
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), true)
  assert.equal(sandbox.el('remote-expand').getAttribute('aria-hidden'), 'false')
  assert.equal(sandbox.el('remote-url').value, 'https://api.slime.example.com')

  // Submit remote URL
  sandbox.el('remote-url').value = 'remote.example.com/'
  await sandbox.el('remote-form').dispatchEvent('submit')
  await flushMicrotasks()
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'desktop_choose_remote' && c.args.url === 'remote.example.com/'),
  )

  // Return button restores initial 2-button stage
  await sandbox.el('remote-back').click()
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), false)
  assert.equal(sandbox.el('remote-expand').getAttribute('aria-hidden'), 'true')

  // Local launch button invokes desktop_choose_local
  await sandbox.el('choose-local').click()
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_choose_local'))

  // Open bottom-left account popover
  await sandbox.el('account-btn').click()
  assert.equal(sandbox.el('account-panel').hidden, false)
  assert.equal(sandbox.el('account-btn').getAttribute('aria-expanded'), 'true')
  assert.equal(sandbox.el('user-ids').children.length, 2)
  assert.equal(sandbox.el('sso-profile').hidden, false)
  assert.equal(sandbox.el('sso-host').textContent, '已连接 mail.ginpika.cc')
  assert.equal(sandbox.el('hostid-form').hidden, true)

  // Switch identity from SSO to local
  await sandbox.el('user-ids').children[0].click()
  await flushMicrotasks()
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_switch_user' && c.args.kind === 'local'))
  assert.equal(sandbox.el('account-btn-avatar').textContent, '本')

  // Save local user name
  sandbox.el('local-name').value = '工作区用户'
  await sandbox.el('save-local').click()
  await flushMicrotasks()
  assert.ok(
    sandbox.invokes.some((c) => c.cmd === 'desktop_save_local_user' && c.args.name === '工作区用户'),
  )
  assert.equal(sandbox.el('account-btn-avatar').textContent, '工')

  // Logout SSO
  await sandbox.el('logout-sso').click()
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_logout_hostid'))

  // Open remote + account panel -> Escape closes account panel first, second Escape collapses remote
  await sandbox.el('open-remote').click()
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), true)
  await sandbox.doc.dispatchEvent('keydown', { key: 'Escape' })
  assert.equal(sandbox.el('account-panel').hidden, true)
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), true)
  await sandbox.doc.dispatchEvent('keydown', { key: 'Escape' })
  assert.equal(sandbox.el('launch-stage').classList.contains('is-remote'), false)

  // Outside pointerdown dismisses open account panel
  await sandbox.el('account-btn').click()
  assert.equal(sandbox.el('account-panel').hidden, false)
  await sandbox.doc.dispatchEvent('pointerdown', { target: sandbox.outsideEl })
  assert.equal(sandbox.el('account-panel').hidden, true)
})

test('expired SSO session shows notice banner + danger dot, allows login and dismissal', async () => {
  let reloginRejects = false
  const sandbox = runLauncherSandbox({
    platform: 'Win32',
    invokeHandler: async (cmd) => {
      if (cmd === 'desktop_state') {
        return {
          mode: 'local',
          remoteBaseUrl: '',
          phase: 'idle',
          detail: '',
          sessionExpired: true,
          instance: null,
        }
      }
      if (cmd === 'desktop_users') {
        return {
          current: 'local',
          local: { name: '本地用户', avatar: '' },
          sso: null,
        }
      }
      if (cmd === 'desktop_hostid_base') return 'https://hostid.example.com'
      if (cmd === 'desktop_relogin_hostid' && reloginRejects) {
        throw new Error('请先输入 HostID 服务端地址')
      }
      return null
    },
  })

  await flushMicrotasks()

  assert.equal(sandbox.doc.body.classList.contains('is-mac'), false)
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'plugin:window|is_maximized'))
  assert.equal(sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_theme'), false)
  assert.equal(sandbox.el('session-banner').hidden, false)
  assert.equal(sandbox.el('account-dot').hidden, false)
  assert.equal(sandbox.el('account-dot').className, 'account-dot account-dot--danger')
  assert.equal(sandbox.el('sso-badge').textContent, '会话已失效')
  assert.equal(sandbox.el('sso-profile').hidden, true)
  assert.equal(sandbox.el('hostid-form').hidden, false)
  assert.equal(sandbox.el('login-hostid').textContent, '重新登录')
  assert.equal(sandbox.el('hostid-url').value, 'https://hostid.example.com')

  // HostID form login
  await sandbox.el('hostid-form').dispatchEvent('submit')
  assert.ok(
    sandbox.invokes.some(
      (c) => c.cmd === 'desktop_login_hostid' && c.args.url === 'https://hostid.example.com',
    ),
  )

  // Session relogin fallback opens account panel when server address is missing
  reloginRejects = true
  await sandbox.el('session-relogin').click()
  await flushMicrotasks()
  assert.equal(sandbox.el('account-panel').hidden, false)
  assert.equal(sandbox.el('hostid-url').focused, true)

  // Dismiss session banner
  await sandbox.el('session-dismiss').click()
  assert.equal(sandbox.el('session-banner').hidden, true)
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_dismiss_session_notice'))
})
