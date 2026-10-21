/**
 * Zero-dependency verification for the merged hover-polish feature.
 *
 * Run with `node checks/hover-polish.mjs`. The shipped browser bundle is loaded
 * with only this feature built (the bundle's test filter); the suite mounts the
 * real client component through a fake React runtime, a DOM-shaped fake and
 * synthetic pointer/focus events, and reads the merged manifest contract.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
const clientSource = read('client.js')

let checks = 0

/** Run one named check. */
async function check(name, body) {
  try {
    await body()
    checks += 1
    console.log('ok ' + name)
  } catch (error) {
    console.error('FAIL ' + name)
    console.error('     ' + (error?.message ?? error))
    process.exitCode = 1
  }
}

/** Flatten rendered text. */
function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  if (element.children === undefined) return textOf(element.props?.children)
  return Array.isArray(element.children) ? element.children.map(textOf).join('') : textOf(element.children)
}

/** Find rendered elements matching a predicate. */
function findAll(root, predicate) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) walk(child); return }
    if (predicate(node)) found.push(node)
    walk(node.children)
  }
  walk(root)
  return found
}

/** Find one rendered element. */
function findOne(root, predicate) {
  const matches = findAll(root, predicate)
  assert(matches.length >= 1, 'expected one match, found ' + matches.length)
  return matches[0]
}

/**
 * Extract one merged feature's section of the shipped bundle.
 * @param {string} id - merged feature id.
 * @returns {string} the feature body slice.
 */
function featureSource(id) {
  const marker = '* Feature: ' + id
  const start = clientSource.indexOf(marker)
  assert(start !== -1, 'bundle carries feature ' + id)
  const next = clientSource.indexOf('* Feature: ', start + marker.length)
  return clientSource.slice(start, next === -1 ? undefined : next)
}

/** Extract the stylesheet template of one merged feature. */
function featureCSS(id) {
  const source = featureSource(id)
  const start = source.indexOf('const CSS = `')
  const end = source.indexOf('\n`', start)
  assert(start !== -1 && end !== -1, 'stylesheet found for ' + id)
  return source.slice(start, end)
}

// ---------------------------------------------------------------------------
// 1. Static contract
// ---------------------------------------------------------------------------

await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.3.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'), 'layout inject')
  assert.equal(manifest.scripts.check, 'node scripts/check.mjs')
})

await check('all manifest files exist on disk', () => {
  for (const relative of [
    manifest.main, 'client.js', manifest.dsh.bundle.patch,
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.en.md',
    'CHANGELOG.md', 'LICENSE',
  ]) assert(fs.existsSync(path.join(ROOT, relative)), relative + ' exists')
})

await check('bundle patch inserts exactly one codex-style row', () => {
  const patch = read('cordis.patch.yml')
  assert(patch.includes('- insert:'))
  assert(patch.includes('id: codex-style'))
  assert(patch.includes("name: 'dsh-codex-style'"))
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

await check('merged client only requires the frozen platform modules', () => {
  const requires = [...new Set([...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]))].sort()
  assert.deepEqual(requires, [
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
    'react-dom',
  ])
})

await check('stylesheet uses theme tokens and no literal colors', () => {
  const css = featureCSS('dsh-hover-polish')
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]), [], 'literal colors')
  assert(css.includes('var(--dsw-'), 'theme tokens present')
  assert(css.includes('.dshhp-tooltip'), 'custom tooltip styles')
})

await check('tabs keep one type scale without extra hover frames', () => {
  const css = featureCSS('dsh-hover-polish')
  assert(css.includes('[data-dockkit-tab]'), 'tab selector')
  assert(!/\[role="tab"\][^{]*:hover[^{}]*\{[^}]*outline/.test(css), 'extra tab hover frame')
  assert(css.includes('font-weight: 500'), 'medium tab label')
  assert(css.includes('border-radius: 8px'), '8px tab pill')
})

await check('locale files carry title and description', () => {
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(read('locale/' + language + '.json')).meta
    assert.equal(typeof meta.title, 'string', language + ' title')
    assert.equal(typeof meta.description, 'string', language + ' description')
    assert(meta.title.length > 0 && meta.description.length > 0, language + ' non-empty')
  }
})

await check('icon is a valid accent SVG', () => {
  const icon = read('icon.svg')
  assert(icon.startsWith('<svg'), 'svg root')
  assert(icon.includes('viewBox="0 0 64 64"'), 'view box')
  assert(icon.includes('#4D6BFE'), 'host accent')
})

// ---------------------------------------------------------------------------
// 2. Fake runtime and DOM
// ---------------------------------------------------------------------------

/** Small React runtime with linear hook slots. */
function createFakeReact() {
  const hooks = []
  let cursor = 0
  let dirty = false
  let queuedEffects = []

  const depsEqual = (left, right) => {
    if (left === undefined || right === undefined) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }

  const react = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      const flat = []
      const push = (child) => {
        if (child === null || child === undefined || typeof child === 'boolean') return
        if (Array.isArray(child)) { for (const value of child) push(value); return }
        flat.push(child)
      }
      for (const child of children) push(child)
      if (flat.length === 1) merged.children = flat[0]
      else if (flat.length > 1) merged.children = flat
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next
        if (Object.is(value, hooks[index])) return
        hooks[index] = value
        dirty = true
      }
      return [hooks[index], setState]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect(effect, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous !== undefined && previous !== null && previous.deps !== undefined
        && depsEqual(previous.deps, deps)) return
      hooks[index] = { deps }
      queuedEffects.push(effect)
    },
    Fragment: Symbol('Fragment'),
  }
  react.useLayoutEffect = react.useEffect

  return {
    react,
    begin() { cursor = 0; dirty = false; queuedEffects = [] },
    end() {
      const effects = queuedEffects
      queuedEffects = []
      for (const effect of effects) effect()
      return effects.length
    },
    isDirty: () => dirty,
  }
}

/** Render one component tree, running effects until stable. */
function mountComponent(component, props, runtime) {
  let tree = null
  const renderTree = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderTree)
    const { type, props: elementProps } = node
    if (typeof type === 'function') return renderTree(type(elementProps))
    const host = { type, props: elementProps, children: [] }
    const children = elementProps.children
    if (Array.isArray(children)) host.children = children.map(renderTree)
    else if (children !== undefined) host.children = renderTree(children)
    return host
  }
  const rerender = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      runtime.begin()
      tree = renderTree(component(props))
      const ran = runtime.end()
      if (!runtime.isDirty() && ran === 0) break
    }
    return tree
  }
  rerender()
  return { get tree() { return tree }, rerender }
}

/** Fake button-shaped element. */
function createButton(options = {}) {
  const attributes = new Map()
  if (options.title !== undefined) attributes.set('title', options.title)
  if (options.ariaLabel !== undefined) attributes.set('aria-label', options.ariaLabel)
  if (options.shortcut !== undefined) attributes.set('aria-keyshortcuts', options.shortcut)
  const button = {
    disabled: options.disabled === true,
    innerText: options.text ?? '',
    textContent: options.text ?? '',
    ownerDocument: options.ownerDocument ?? null,
    dataset: {},
    className: '',
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
    setAttribute(name, value) { attributes.set(name, String(value)) },
    removeAttribute(name) { attributes.delete(name) },
    hasAttribute(name) { return attributes.has(name) },
    closest(selector) {
      if (selector === 'button' || selector.includes('[role="button"]') || selector.includes('[role="tab"]')) return button
      if (selector.includes('role="menu"')) return options.menu === true ? {} : null
      if (selector === '[data-dshhp-skip]') return null
      return null
    },
    contains() { return false },
    getBoundingClientRect() { return { left: 100, right: 130, top: 200, bottom: 228, width: 30, height: 28 } },
  }
  return button
}

/** DOM-shaped fake with listeners, tooltips and timers. */
function createFakeDocument() {
  const listeners = new Map()
  const rootAttributes = new Map()
  return {
    body: {},
    documentElement: {
      dataset: {},
      setAttribute(name, value) { rootAttributes.set(name, String(value)) },
      removeAttribute(name) { rootAttributes.delete(name) },
      getAttribute(name) { return rootAttributes.has(name) ? rootAttributes.get(name) : null },
      hasAttribute(name) { return rootAttributes.has(name) },
    },
    hostTooltips: [],
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    getElementById: () => null,
    querySelectorAll(selector) {
      return selector === '[role="tooltip"]' ? this.hostTooltips : []
    },
    addEventListener(type, callback, capture) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push({ callback, capture })
    },
    removeEventListener(type, callback, capture) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry.callback !== callback || entry.capture !== capture))
    },
    dispatch(type, event) {
      for (const entry of listeners.get(type) ?? []) entry.callback(event)
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length },
  }
}

/** Fake browser window with timers and computed style. */
function createFakeWindow() {
  const timers = new Map()
  let nextTimer = 0
  let background = 'transparent'
  return {
    innerWidth: 1440,
    innerHeight: 900,
    setTimeout(callback) { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer },
    clearTimeout(id) { timers.delete(id) },
    __runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
    },
    setBackground(value) { background = value },
    getComputedStyle() { return { backgroundColor: background,
      getPropertyValue: (name) => ['--dsh-frame-chrome-top', '--dsh-windows-titlebar-height'].includes(name) ? '40px' : '' } },
  }
}

/** Load the merged client module with only hover-polish built. */
function loadClientModule(reactRuntime, fakeDocument, fakeWindow) {
  let loaded
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-hover-polish'],
    window: {
      ...fakeWindow,
      __ModuleLoader__: { load(definition) { loaded = definition } },
    },
    document: fakeDocument,
    console,
    setTimeout: fakeWindow.setTimeout,
    clearTimeout: fakeWindow.clearTimeout,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  return loaded.factory((id) => {
    if (id === 'react') return reactRuntime.react
    if (id === 'react-dom') return { createPortal: (element) => element }
    throw new Error('unexpected require ' + id)
  })
}

/** Mount the overlay from one applied plugin. */
function scenario(options = {}) {
  const reactRuntime = createFakeReact()
  const fakeDocument = createFakeDocument()
  const fakeWindow = createFakeWindow()
  fakeWindow.setBackground(options.background ?? 'transparent')
  const registrations = []
  const localeRegistrations = []
  const plugin = loadClientModule(reactRuntime, fakeDocument, fakeWindow)
  const ctx = {
    effect: (factory) => { factory(); return () => {} },
    locale: {
      register: (ns, dicts) => { localeRegistrations.push({ ns, dicts }); return () => {} },
      bind: () => (key) => key,
    },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (registration, component) => {
        registrations.push({ registration, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const overlay = registrations.find((entry) => entry.registration.name === 'shell.overlay')
  const harness = mountComponent(overlay.component, { ...overlay.registration.inject?.() }, reactRuntime)
  return { harness, fakeDocument, fakeWindow, plugin, registrations, localeRegistrations }
}

/** Synthetic event for one button. */
function eventFor(button, overrides = {}) {
  return { target: button, relatedTarget: null, key: '', ...overrides }
}

/** Find the custom tooltip. */
function tooltipOf(harness) {
  return findAll(harness.tree, (element) => element.props?.className === 'dshhp-tooltip')
}

/** Run pending tooltip delay and rerender. */
function reveal(harness, fakeWindow) {
  fakeWindow.__runTimers()
  harness.rerender()
}

// ---------------------------------------------------------------------------
// 3. Behaviour
// ---------------------------------------------------------------------------

await check('factory registers one global overlay', () => {
  const { registrations, plugin } = scenario()
  assertEqual([...plugin.inject].sort(), ['locale', 'slots'])
  assertEqual(registrations.length, 1)
  assertEqual(registrations[0].registration.name, 'shell.overlay')
  assertEqual(registrations[0].registration.id, 'hover-polish.tooltip')
})

await check('native title buttons get a styled tooltip instead of the OS bubble', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ title: 'README.md', ownerDocument: fakeDocument })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assert.equal(button.getAttribute('title'), null, 'native title suppressed')
  reveal(harness, fakeWindow)
  const tip = tooltipOf(harness)
  assertEqual(tip.length, 1)
  assert(textOf(tip[0]).includes('README.md'))
})

await check('leaving a native-title button restores the title and hides the tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ title: 'README.md', ownerDocument: fakeDocument })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  fakeDocument.dispatch('pointerout', eventFor(button))
  harness.rerender()
  assertEqual(button.getAttribute('title'), 'README.md')
  assertEqual(tooltipOf(harness).length, 0)
})

await check('aria-label buttons without a title also get the tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: '搜索' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assert(textOf(tooltipOf(harness)[0]).includes('搜索'))
})

await check('a visible Host tooltip suppresses the custom duplicate', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  fakeDocument.hostTooltips = [{
    className: '_bubble_test',
    getAttribute: (name) => name === 'data-side' ? 'right' : null,
    getClientRects: () => [{ width: 10, height: 10 }],
  }]
  const button = createButton({ ariaLabel: 'Search' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0)
})

await check('Host tooltips are re-anchored to the button center', () => {
  const { fakeDocument } = scenario()
  const tip = {
    dataset: { side: 'right' },
    style: {},
    // Production CSS-module hashes need not contain a readable "bubble" token.
    className: 'x1y2z3',
    getAttribute: (name) => name === 'data-side' ? 'right' : null,
    hasAttribute: () => false,
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 60, right: 140, top: 150, bottom: 170, width: 80, height: 20 }),
  }
  fakeDocument.hostTooltips = [tip]
  const button = createButton({ title: 'Pin chat' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(tip.style.left, '75px', 'left edge of the centered bubble')
  assertEqual(tip.style.top, '172px', 'placed above the anchor')
  assertEqual(tip.dataset.side, 'top')
  assertEqual(tip.dataset.align, 'center')
  assertEqual(tip.dataset.dshhpReady, '', 'revealed only after positioning')
  assertEqual(fakeDocument.documentElement.getAttribute('data-dshhp-hover'), '', 'insertion window marked')
})

await check('Windows header tooltips avoid native caption controls and retain fullscreen placement', () => {
  for (const fullscreen of [false, true]) {
    const { fakeDocument } = scenario()
    fakeDocument.documentElement.setAttribute('data-windows-titlebar', '')
    if (fullscreen) fakeDocument.documentElement.setAttribute('data-fullscreen', '')
    const tip = {
      dataset: { side: 'top' }, style: { setProperty(name, value) { this[name] = value } },
      className: 'native-tooltip', getAttribute: (name) => name === 'data-side' ? 'top' : null,
      hasAttribute: () => false, getClientRects: () => [{ width: 184, height: 26 }],
      getBoundingClientRect: () => ({ width: 184, height: 26 }),
    }
    fakeDocument.hostTooltips = [tip]
    const button = createButton({ title: 'Open folder' })
    button.getBoundingClientRect = () => ({ left: 1335, right: 1363, top: 52, bottom: 80, width: 28, height: 28 })
    fakeDocument.dispatch('pointerover', eventFor(button))
    assertEqual(tip.style.top, fullscreen ? '18px' : '88px')
    assertEqual(tip.style['--dshhp-top'], fullscreen ? '18px' : '88px')
    assertEqual(tip.dataset.side, fullscreen ? 'top' : 'bottom')
  }
})

await check('foreign role=tooltip hover cards are left untouched', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const card = {
    dataset: { side: undefined },
    style: {},
    classList: { contains: (name) => name === 'dshss-hoverCard' },
    getAttribute: () => null,
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 0, right: 120, top: 0, bottom: 20, width: 120, height: 20 }),
  }
  fakeDocument.hostTooltips = [card]
  const button = createButton({ ariaLabel: 'Pin chat' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(card.style.left, undefined, 'foreign card was not repositioned')
  assertEqual(card.style.top, undefined, 'foreign card was not repositioned vertically')
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0, 'foreign card suppresses a duplicate custom tooltip')
})

await check('foreign cards carrying a stale data-side are cleaned, not centered', () => {
  const { fakeDocument } = scenario()
  const attributes = new Map([['data-side', 'top']])
  const card = {
    dataset: { side: 'top' },
    style: {},
    className: 'dshss-hoverCard',
    classList: { contains: (name) => name === 'dshss-hoverCard' },
    getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
    removeAttribute: (name) => { attributes.delete(name) },
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 0, right: 120, top: 0, bottom: 20, width: 120, height: 20 }),
  }
  fakeDocument.hostTooltips = [card]
  const button = createButton({ ariaLabel: 'Pin chat' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(card.style.left, undefined, 'foreign card was not repositioned')
  assertEqual(attributes.has('data-side'), false, 'stale marker removed')
})

await check('labeled model selector gets an explanatory tooltip, not its label', () => {
  const { harness, fakeDocument, fakeWindow, localeRegistrations } = scenario()
  const button = createButton({
    text: 'DeepSeek-V4.1-Flash 1017 Max',
    ariaLabel: '选择模型，当前 DeepSeek-V4.1-Flash，推理等级 Max',
  })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  const tip = tooltipOf(harness)[0]
  assert(tip, 'tooltip rendered')
  assert(textOf(tip).includes('explain.model'), 'explanation used')
  assert(!textOf(tip).includes('DeepSeek-V4.1-Flash 1017 Max'), 'does not repeat visible label')
  assert.equal(localeRegistrations[0].ns, 'hoverPolish')
})

await check('visible-text buttons do not get a custom tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ text: 'New chat', title: 'New chat' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0, 'no redundant bubble')
  assertEqual(button.getAttribute('title'), 'New chat', 'title untouched')
})

await check('the send button is skipped entirely', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: '发送' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0, 'no send bubble')
  assertEqual(button.getAttribute('data-dshhp-hover'), null, 'no extra hover surface')
})

await check('Host tooltips flip below when the top edge cannot fit', () => {
  const { fakeDocument } = scenario()
  const tip = {
    dataset: { side: 'top' },
    style: {},
    className: '_bubble_test',
    getAttribute: (name) => name === 'data-side' ? 'top' : null,
    hasAttribute: () => false,
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 60, right: 140, top: 0, bottom: 20, width: 80, height: 20 }),
  }
  fakeDocument.hostTooltips = [tip]
  const button = createButton({ ariaLabel: 'Toolbar' })
  button.getBoundingClientRect = () => ({ left: 100, right: 130, top: 10, bottom: 40, width: 30, height: 30 })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(tip.dataset.side, 'bottom')
  assertEqual(tip.style.top, '48px')
})

await check('leaving the control ends the tooltip insertion window', () => {
  const { fakeDocument, fakeWindow, harness } = scenario()
  const tip = {
    dataset: { side: 'right' },
    style: {},
    className: 'x1y2z3',
    getAttribute: (name) => name === 'data-side' ? 'right' : null,
    hasAttribute: () => false,
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 60, right: 140, top: 150, bottom: 170, width: 80, height: 20 }),
  }
  fakeDocument.hostTooltips = [tip]
  const button = createButton({ title: 'README' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(fakeDocument.documentElement.getAttribute('data-dshhp-hover'), '')
  fakeDocument.dispatch('pointerout', eventFor(button))
  harness.rerender()
  assertEqual(fakeDocument.documentElement.getAttribute('data-dshhp-hover'), '', 'hidden through the leave frame')
  fakeWindow.__runTimers()
  assertEqual(fakeDocument.documentElement.getAttribute('data-dshhp-hover'), null, 'marker removed after grace')
})

await check('ARIA shortcuts render as a keycap beside the label', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: 'Search', shortcut: 'Control+Shift+M' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  const tip = tooltipOf(harness)[0]
  assert(textOf(tip).includes('Ctrl+Shift+M'), 'platform-formatted shortcut')
})

await check('repeated shortcut keycaps are deduplicated', () => {
  const custom = scenario()
  const button = createButton({ title: '停止生成', shortcut: 'Escape Escape' })
  custom.fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(custom.harness, custom.fakeWindow)
  const customKeys = findAll(tooltipOf(custom.harness)[0], (element) => element.props?.className === 'dshhp-key')
  assertEqual(customKeys.length, 1, 'custom tooltip keeps one keycap')

  const hosted = scenario()
  const keys = [
    { textContent: 'Esc', style: {}, setAttribute() {}, hasAttribute: () => false, removeAttribute() {} },
    { textContent: 'Esc', style: {}, setAttribute() {}, hasAttribute: () => false, removeAttribute() {} },
  ]
  const tip = {
    dataset: { side: 'top' },
    style: {},
    className: 'x1y2z3',
    getAttribute: (name) => name === 'data-side' ? 'top' : null,
    hasAttribute: () => false,
    getClientRects: () => [{ width: 80, height: 20 }],
    getBoundingClientRect: () => ({ left: 60, right: 140, top: 150, bottom: 170, width: 80, height: 20 }),
    querySelectorAll: (selector) => selector === 'kbd' ? keys : [],
  }
  hosted.fakeDocument.hostTooltips = [tip]
  const hostButton = createButton({ title: '停止生成' })
  hosted.fakeDocument.dispatch('pointerover', eventFor(hostButton))
  assertEqual(keys[1].style.display, 'none', 'host duplicate hidden')
})

await check('clicking a control dismisses its explanatory tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({
    text: 'DeepSeek-V4.1-Flash 1017 Max',
    ariaLabel: '选择模型，当前 DeepSeek-V4.1-Flash，推理等级 Max',
  })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 1, 'tooltip before click')
  fakeDocument.dispatch('pointerdown', eventFor(button))
  harness.rerender()
  assertEqual(tooltipOf(harness).length, 0, 'tooltip gone after click')
})

await check('a clicked control stays quiet until the pointer leaves', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: '锁定，本轮结束不发送' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 1, 'tooltip before click')
  fakeDocument.dispatch('pointerdown', eventFor(button))
  harness.rerender()
  assertEqual(tooltipOf(harness).length, 0, 'click dismisses it')
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0, 'suppressed while the pointer stays')
  fakeDocument.dispatch('pointerout', eventFor(button))
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 1, 're-entering shows it again')
})

await check('transparent icon buttons receive the shared hover surface', () => {
  const { fakeDocument } = scenario({ background: 'rgba(0, 0, 0, 0)' })
  const button = createButton({ ariaLabel: 'Pin chat' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(button.getAttribute('data-dshhp-hover'), 'icon')
})

await check('filled buttons keep their own hover surface', () => {
  const { fakeDocument } = scenario({ background: 'rgb(77, 107, 254)' })
  const button = createButton({ ariaLabel: 'Send' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(button.getAttribute('data-dshhp-hover'), null)
})

await check('role=tab controls get the same tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const tab = createButton({ title: 'README.md' })
  tab.setAttribute('role', 'tab')
  fakeDocument.dispatch('pointerover', eventFor(tab))
  reveal(harness, fakeWindow)
  assert(textOf(tooltipOf(harness)[0]).includes('README.md'))
})

await check('queue drag handles keep their transparent background', () => {
  const { fakeDocument } = scenario()
  const button = createButton({ ariaLabel: '拖动排序排队消息' })
  button.setAttribute('data-dshq-handle', '')
  fakeDocument.dispatch('pointerover', eventFor(button))
  assertEqual(button.getAttribute('data-dshhp-hover'), null, 'drag handle acquired generic hover fill')
})

await check('a visible text tab does not get a duplicate hover bubble', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const tab = createButton({ text: 'bilibili-article.md', title: 'D:\\dsh-plugins\\dsh-sidebar-sections\\docs\\bilibili-article.md' })
  tab.setAttribute('role', 'tab')
  fakeDocument.dispatch('pointerover', eventFor(tab))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0, 'the visible tab label already describes the control')
})

await check('menu items are skipped', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ title: 'Rename', menu: true })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0)
  assertEqual(button.getAttribute('title'), 'Rename', 'menu title untouched')
})

await check('disabled buttons and plain text buttons are skipped', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const disabled = createButton({ title: 'Disabled', disabled: true })
  fakeDocument.dispatch('pointerover', eventFor(disabled))
  const text = createButton({ text: 'Save' })
  fakeDocument.dispatch('pointerover', eventFor(text))
  reveal(harness, fakeWindow)
  assertEqual(tooltipOf(harness).length, 0)
  assertEqual(disabled.getAttribute('title'), 'Disabled')
})

await check('keyboard focus can reveal the same tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: 'Settings' })
  fakeDocument.dispatch('focusin', eventFor(button))
  reveal(harness, fakeWindow)
  assert(textOf(tooltipOf(harness)[0]).includes('Settings'))
})

await check('scrolling dismisses the tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: 'Settings' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  fakeDocument.dispatch('scroll', { target: {} })
  harness.rerender()
  assertEqual(tooltipOf(harness).length, 0)
})

await check('Escape dismisses the tooltip', () => {
  const { harness, fakeDocument, fakeWindow } = scenario()
  const button = createButton({ ariaLabel: 'Settings' })
  fakeDocument.dispatch('pointerover', eventFor(button))
  reveal(harness, fakeWindow)
  fakeDocument.dispatch('keydown', { key: 'Escape' })
  harness.rerender()
  assertEqual(tooltipOf(harness).length, 0)
})

await check('the overlay registers listeners and cleans up on unmount semantics', () => {
  const { fakeDocument } = scenario()
  for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'pointerdown', 'click', 'scroll', 'keydown']) {
    assert(fakeDocument.listenerCount(type) >= 1, type + ' listener registered')
  }
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function assertEqual(actual, expected) {
  assert.deepEqual(actual, expected)
}

if (process.exitCode === 1) {
  console.error('\n' + checks + ' check(s) passed, some failed')
} else {
  console.log('\nall checks passed (' + checks + ')')
}
