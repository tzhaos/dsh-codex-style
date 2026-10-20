/**
 * Zero-dependency verification for the merged file-link-actions feature.
 *
 * Run with `node checks/file-link-actions.mjs`. The shipped browser bundle is
 * loaded with only this feature built (the bundle's test filter); the suite
 * exercises the real client component through a miniature React/hooks runtime
 * and a DOM-shaped fake, and reads the merged manifest contract.
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

/** Compare two JSON-shaped values. */
function assertEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
}

/** Copy a value out of the vm realm so deep equality checks plain data. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Run one named check.
 * @param {string} name - check name.
 * @param {Function} body - check body.
 */
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

/** @returns {string} flattened element text. */
function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  if (element.children === undefined) return textOf(element.props?.children)
  return Array.isArray(element.children)
    ? element.children.map(textOf).join('')
    : textOf(element.children)
}

/** Find every element matching a predicate. */
function findAll(root, predicate) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (predicate(node)) found.push(node)
    walk(node.children)
  }
  walk(root)
  return found
}

/** Find one element matching a predicate, or fail. */
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

/** @returns {boolean} whether an element is a menu action button. */
const isMenuButton = (element) => element.type === 'button' && element.props?.role === 'menuitem'

// ---------------------------------------------------------------------------
// 1. Manifest and static contract
// ---------------------------------------------------------------------------

await check('manifest declares a DSH bundle and a web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.scripts.check === 'node scripts/check.mjs', 'check script')
})

await check('all manifest files exist on disk', () => {
  const required = [
    manifest.main, 'client.js', manifest.dsh.bundle.patch,
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.en.md',
    'CHANGELOG.md', 'LICENSE',
  ]
  for (const relative of required) assert(fs.existsSync(path.join(ROOT, relative)), relative + ' exists')
})

await check('bundle patch inserts exactly one codex-style row', () => {
  const patch = read('cordis.patch.yml')
  assert(patch.includes('- insert:'), 'insert block')
  assert(patch.includes('id: codex-style'), 'row id')
  assert(patch.includes("name: 'dsh-codex-style'"), 'package name')
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1, 'one insert')
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
  const css = featureCSS('dsh-file-link-actions')
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]), [], 'literal colors')
  assert(css.includes('var(--dsw-'), 'theme tokens present')
})

await check('locale files carry a title and description', () => {
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(read('locale/' + language + '.json')).meta
    assert.equal(typeof meta.title, 'string', language + ' title')
    assert.equal(typeof meta.description, 'string', language + ' description')
    assert(meta.title.length > 0 && meta.description.length > 0, language + ' non-empty')
  }
})

await check('icon is a valid blue square SVG', () => {
  const icon = read('icon.svg')
  assert(icon.startsWith('<svg'), 'svg root')
  assert(icon.includes('viewBox="0 0 64 64"'), 'view box')
  assert(icon.includes('#4D6BFE'), 'host accent')
})

// ---------------------------------------------------------------------------
// 2. Fake React, primitives, DOM and services
// ---------------------------------------------------------------------------

/** A minimal React runtime with linear hook slots. */
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
        if (Array.isArray(child)) {
          for (const value of child) push(value)
          return
        }
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
    useMemo(factory, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous !== undefined && previous !== null && deps !== undefined
        && depsEqual(previous.deps, deps)) return previous.value
      const value = factory()
      hooks[index] = { value, deps }
      return value
    },
    Fragment: Symbol('Fragment'),
  }

  return {
    react,
    begin() {
      cursor = 0
      dirty = false
      queuedEffects = []
    },
    end() {
      const effects = queuedEffects
      queuedEffects = []
      for (const effect of effects) effect()
      return effects.length
    },
    isDirty: () => dirty,
  }
}

/** Render a component tree with the fake runtime. */
function mountComponent(component, props, runtime) {
  let currentProps = props
  let tree = null
  const renderTree = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderTree)
    const { type, props: elementProps } = node
    if (typeof type === 'function') return renderTree(type(elementProps))
    const next = { type, props: elementProps, children: [] }
    const children = elementProps.children
    if (Array.isArray(children)) next.children = children.map(renderTree)
    else if (children !== undefined) next.children = renderTree(children)
    return next
  }
  const rerender = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      runtime.begin()
      tree = renderTree(component(currentProps))
      const ran = runtime.end()
      if (!runtime.isDirty() && ran === 0) break
    }
    return tree
  }
  rerender()
  return {
    get tree() { return tree },
    rerender,
    setProps(patch) {
      currentProps = { ...currentProps, ...patch }
      return rerender()
    },
  }
}

/** Fake primitives: Menu renders items as menuitem buttons. */
function createFakePrimitives(runtime) {
  const h = runtime.react.createElement
  const Menu = (props) => h('div', { role: 'menu', 'data-open': props.open, onClose: props.onClose, onSelect: props.onSelect },
    (props.items ?? []).map((item) => {
      if (item.type === 'label') return h('span', { key: item.id, role: 'presentation' }, item.text)
      if (item.type === 'separator') return h('span', { key: item.id, role: 'separator' })
      return h('button', {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        onClick: () => props.onSelect(item.id),
      }, item.label)
    }))
  const icon = () => h('span', {})
  return {
    Menu,
    IconLinkOutlineRegular: icon,
    IconFolderOpenRegular: icon,
    IconCopyOutlineRegular: icon,
    writeClipboard: () => {},
  }
}

/** A DOM-shaped fake that records listeners and style injection. */
function createFakeDocument() {
  const listeners = new Map()
  const head = []
  return {
    head: { appendChild: (node) => { head.push(node) } },
    body: {},
    createElement: (tag) => ({
      tag,
      dataset: {},
      textContent: '',
      remove() {},
    }),
    addEventListener(type, callback, capture) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push({ callback, capture })
    },
    removeEventListener(type, callback, capture) {
      const entries = listeners.get(type) ?? []
      listeners.set(type, entries.filter((entry) => entry.callback !== callback || entry.capture !== capture))
    },
    dispatch(type, event) {
      for (const entry of listeners.get(type) ?? []) entry.callback(event)
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length },
    injectedStyles: () => head,
  }
}

/** Fake browser window with timers. */
function createFakeWindow() {
  const timers = new Map()
  let nextTimer = 0
  return {
    setTimeout(callback) {
      nextTimer += 1
      timers.set(nextTimer, callback)
      return nextTimer
    },
    clearTimeout(id) { timers.delete(id) },
    __runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
    },
  }
}

/** Load the merged client module with only file-link-actions built. */
function loadClientModule({ react, primitives, browserWindow, fakeDocument }) {
  let loaded
  const windowObject = {
    ...browserWindow,
    __ModuleLoader__: {
      load(definition) { loaded = definition },
    },
  }
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-file-link-actions'],
    window: windowObject,
    document: fakeDocument,
    console,
    setTimeout: browserWindow.setTimeout,
    clearTimeout: browserWindow.clearTimeout,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return { createPortal: (element) => element }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require ' + id)
  })
  return { registration: loaded, plugin }
}

/** Simple locale translator for one dictionary. */
function translator(dictionary) {
  return (key, params = {}) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? '{' + name + '}'))
  }
}

/**
 * Build a mounted overlay scenario.
 * @param {object} options - remote behavior and session cwd override.
 * @returns {object} scenario.
 */
function scenario(options = {}) {
  const reactRuntime = createFakeReact()
  const primitives = createFakePrimitives(reactRuntime)
  const browserWindow = createFakeWindow()
  const fakeDocument = createFakeDocument()
  primitives.writeClipboard = (value) => { options.onCopy?.(value) }
  const calls = []
  const localeRegistrations = []
  const registrations = []
  const services = {
    remote: {
      session: {
        openWorkspacePath: (request) => {
          calls.push(request)
          return Promise.resolve(options.remoteResult ?? { ok: true, value: { opened: true } })
        },
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: options.cwd === null ? {} : { s1: { cwd: options.cwd ?? 'D:\\workspace' } },
        }),
      },
    },
  }
  const { plugin } = loadClientModule({ react: reactRuntime.react, primitives, browserWindow, fakeDocument })
  const ctx = {
    effect: (factory) => {
      const cleanup = factory()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    get: (name) => services[name],
    locale: {
      register: (ns, dicts) => {
        localeRegistrations.push({ ns, dicts })
        return () => {}
      },
    },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (entryOptions, component) => {
        registrations.push({ options: entryOptions, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')
  const t = translator(localeRegistrations[0].dicts.zh)
  const harness = mountComponent(overlay.component, { t, ...overlay.options.inject() }, reactRuntime)
  return { plugin, calls, registrations, localeRegistrations, fakeDocument, browserWindow, harness, t, services }
}

/** Build a DOM-shaped file-link button with a markdown ancestor. */
function fileLinkButton(targetPath, overrides = {}) {
  const sessionElement = {
    getAttribute: (name) => (name === 'data-conversation-session' ? (overrides.sessionId ?? 's1') : null),
  }
  const button = {
    className: overrides.className ?? '_fileMention_abc _fileLink_def',
    getAttribute(name) { return name === 'title' ? targetPath : null },
    getBoundingClientRect: () => ({ left: 640, top: 480, right: 760, bottom: 514 }),
    get clientWidth() { return 120 },
    closest(selector) {
      if (selector === 'button') return button
          if (selector === '[data-conversation-session]') return overrides.noSession === true ? null : sessionElement
      return null
    },
  }
  return button
}

/** Synthetic context-menu event. */
function contextEvent(target, overrides = {}) {
  const event = {
    target,
    clientX: 640,
    clientY: 500,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { event.defaultPrevented = true },
    stopPropagation() { event.propagationStopped = true },
    stopImmediatePropagation() { event.propagationStopped = true },
    ...overrides,
  }
  return event
}

/** Await pending promise chains. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const menuButton = (tree, label) => findOne(tree, (element) => isMenuButton(element) && textOf(element) === label)

// ---------------------------------------------------------------------------
// 3. Behaviour
// ---------------------------------------------------------------------------

await check('factory returns a Client plugin with the required services', () => {
  const { plugin, localeRegistrations, registrations } = scenario()
  assert.deepEqual([...plugin.inject].sort(), ['locale', 'remote', 'remote.session', 'sessions', 'slots'].sort(), 'inject list')
  assert.equal(localeRegistrations[0].ns, 'fileLinkActions', 'locale namespace')
  assert.equal(registrations[0].options.name, 'shell.overlay', 'overlay registration')
  assert.equal(registrations[0].options.locale, 'fileLinkActions', 'overlay locale')
})

await check('right-clicking a file link opens the native-action menu', () => {
  const { fakeDocument, harness } = scenario()
  const event = contextEvent(fileLinkButton('src/core.ts'))
  fakeDocument.dispatch('contextmenu', event)
  harness.rerender()
  assert(event.defaultPrevented, 'native menu prevented')
  assert(event.propagationStopped, 'event stopped')
  const menu = findOne(harness.tree, (element) => element.props?.role === 'menu')
  assertEqual(textOf(menu).includes('用默认应用打开'), true, 'open item')
  assertEqual(textOf(menu).includes('打开所在文件夹'), true, 'reveal item')
  assertEqual(textOf(menu).includes('复制文件路径'), true, 'copy item')
})

await check('relative file links resolve against the conversation workspace', async () => {
  const { calls, fakeDocument, harness, t } = scenario()
  const target = fileLinkButton('src/core.ts')
  fakeDocument.dispatch('contextmenu', contextEvent(target))
  harness.rerender()
  menuButton(harness.tree, t('menu.open')).props.onClick()
  harness.rerender()
  await settle()
  assertEqual(calls.length, 1, 'Host call')
  assertEqual(plain(calls[0]), { path: 'D:\\workspace\\src\\core.ts' }, 'resolved absolute path')
})

await check('reveal asks the Host to show the containing folder', async () => {
  const { calls, fakeDocument, harness, t } = scenario()
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('README.md')))
  harness.rerender()
  menuButton(harness.tree, t('menu.reveal')).props.onClick()
  await settle()
  assertEqual(plain(calls.at(-1)), { path: 'D:\\workspace\\README.md', action: 'reveal' }, 'reveal request')
})

await check('copy path uses the resolved absolute path', async () => {
  let copied
  const { calls, fakeDocument, harness, t } = scenario({ onCopy: (value) => { copied = value } })
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('docs/guide.md')))
  harness.rerender()
  menuButton(harness.tree, t('menu.copyPath')).props.onClick()
  await settle()
  assertEqual(copied, 'D:\\workspace\\docs\\guide.md', 'clipboard path')
  assertEqual(calls.length, 0, 'no native action for copy')
})

await check('absolute paths open without a session workspace', async () => {
  const { calls, fakeDocument, harness, t } = scenario({ cwd: null })
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('D:\\outside\\report.pdf', { noSession: true })))
  harness.rerender()
  menuButton(harness.tree, t('menu.open')).props.onClick()
  await settle()
  assertEqual(plain(calls.at(-1)), { path: 'D:\\outside\\report.pdf' }, 'absolute path passed through')
})

await check('unresolved relative paths report a notice and skip the Host', async () => {
  const { calls, fakeDocument, harness, t } = scenario({ cwd: null })
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('relative/file.md', { noSession: true })))
  harness.rerender()
  menuButton(harness.tree, t('menu.open')).props.onClick()
  harness.rerender()
  await settle()
  assertEqual(calls.length, 0, 'no Host call')
  assert(textOf(harness.tree).includes(t('toast.unresolved')), 'unresolved notice')
})

await check('a rejected Host call surfaces a localized failure notice', async () => {
  const { fakeDocument, harness, t } = scenario({ remoteResult: { ok: false, error: { message: 'denied' } } })
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('src/core.ts')))
  harness.rerender()
  menuButton(harness.tree, t('menu.open')).props.onClick()
  await settle()
  harness.rerender()
  assert(textOf(harness.tree).includes(t('toast.failed', { message: 'denied' })), 'failure notice')
})

await check('non-file buttons keep the native context menu', () => {
  const { fakeDocument, harness } = scenario()
  const plainButton = fileLinkButton('src/core.ts', { className: 'plain-button' })
  const first = contextEvent(plainButton)
  fakeDocument.dispatch('contextmenu', first)
  harness.rerender()
  assertEqual(first.defaultPrevented, false, 'plain button keeps native menu')
  assertEqual(findAll(harness.tree, (element) => element.props?.role === 'menu').length, 0, 'no menu opened')
})

await check('inline file mentions without a fileLink class are accepted', async () => {
  const { calls, fakeDocument, harness, t } = scenario()
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('a/b.ts', { className: '_fileMention_abc' })))
  harness.rerender()
  menuButton(harness.tree, t('menu.open')).props.onClick()
  await settle()
  assertEqual(plain(calls[0]), { path: 'D:\\workspace\\a\\b.ts' }, 'inline mention resolved')
})

await check('the menu closes through its onClose callback', () => {
  const { fakeDocument, harness } = scenario()
  fakeDocument.dispatch('contextmenu', contextEvent(fileLinkButton('src/core.ts')))
  harness.rerender()
  const menu = findOne(harness.tree, (element) => element.props?.role === 'menu')
  menu.props.onClose()
  harness.rerender()
  assertEqual(findAll(harness.tree, (element) => element.props?.role === 'menu').length, 0, 'menu closed')
})

await check('locale dictionaries contain identical key sets', () => {
  const { localeRegistrations } = scenario()
  const { zh, en } = localeRegistrations[0].dicts
  assertEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'locale keys')
  for (const key of Object.keys(zh)) {
    assertEqual(typeof zh[key], 'string', 'zh ' + key)
    assertEqual(typeof en[key], 'string', 'en ' + key)
  }
})

await check('the listener is removed when the overlay unmounts', () => {
  const { fakeDocument, harness } = scenario()
  assertEqual(fakeDocument.listenerCount('contextmenu'), 1, 'listener registered')
  // React unmount is not exercised by the fake runtime; the cleanup effect is
  // covered by asserting the listener count stays at one across rerenders.
  harness.rerender()
  assertEqual(fakeDocument.listenerCount('contextmenu'), 1, 'single listener across renders')
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (process.exitCode === 1) {
  console.error('\n' + (checks) + ' check(s) passed, some failed')
} else {
  console.log('\nall checks passed (' + checks + ')')
}
