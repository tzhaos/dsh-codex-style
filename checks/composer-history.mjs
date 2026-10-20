/**
 * Zero-dependency verification for the merged composer-history feature.
 *
 * Run with `node checks/composer-history.mjs`. The suite loads the real merged
 * browser bundle with only the dsh-composer-history feature built (the bundle's
 * test filter) and exercises the trigger, palette, keyboard shortcuts and the
 * merged settings page through a miniature React/hooks runtime, a DOM-shaped
 * fake and a Session event window fixture.
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

/** Compare JSON-shaped values out of the vm realm. */
function equal(actual, expected, message) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)
}

/** Slice one merged feature body out of the generated bundle. */
function featureSource(id) {
  const marker = "__DSH_FEATURE('" + id + "'"
  const start = clientSource.indexOf(marker)
  assert(start !== -1, 'feature ' + id + ' is in the bundle')
  const next = clientSource.indexOf("__DSH_FEATURE('", start + marker.length)
  return next === -1 ? clientSource.slice(start) : clientSource.slice(start, next)
}

/** Flatten rendered text. */
function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  if (element.children === undefined) return textOf(element.props?.children)
  return Array.isArray(element.children) ? element.children.map(textOf).join('') : textOf(element.children)
}

/** Find all rendered elements matching a predicate. */
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

/** Find one rendered element matching a predicate. */
function findOne(root, predicate) {
  const matches = findAll(root, predicate)
  assert(matches.length >= 1, 'expected one match, found ' + matches.length)
  return matches[0]
}

const isButton = (element) => element.type === 'button'
const isOption = (element) => element.type === 'button' && element.props?.role === 'option'
const isDialog = (element) => element.props?.role === 'dialog'

// ---------------------------------------------------------------------------
// 1. Manifest and static contract
// ---------------------------------------------------------------------------

await check('manifest declares the merged DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.1.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'), 'conversation inject')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-session-controller'), 'session inject')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'), 'merged settings inject')
  assert(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), 'no standalone settings tab dependency')
  assert.equal(manifest.scripts.check, 'node scripts/check.mjs')
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

await check('merged client only requires the platform modules', () => {
  const requires = [...new Set([...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]))].sort()
  assert.deepEqual(requires, [
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
    'react-dom',
  ])
})

await check('stylesheet uses theme tokens and no literal colors', () => {
  const source = featureSource('dsh-composer-history')
  const start = source.indexOf('const CSS = `')
  const end = source.indexOf('\n`', start)
  assert(start !== -1 && end !== -1, 'stylesheet found')
  const css = source.slice(start, end)
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]), [], 'literal colors')
  assert(css.includes('var(--dsw-'), 'theme tokens present')
  assert(css.includes('.dshch-trigger'), 'trigger styles')
  assert(css.includes('.dshch-panel'), 'panel styles')
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
// 2. Fake runtime and fixtures
// ---------------------------------------------------------------------------

/** A small React runtime with linear hook slots. */
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

  return {
    react,
    begin() { cursor = 0; dirty = false; queuedEffects = [] },
    reset() { hooks.length = 0; cursor = 0; dirty = false; queuedEffects = [] },
    end() {
      const effects = queuedEffects
      queuedEffects = []
      for (const effect of effects) effect()
      return effects.length
    },
    isDirty: () => dirty,
  }
}

/** Render a component tree and assign host refs. */
function mountComponent(component, props, runtime) {
  let currentProps = props
  let tree = null
  const renderTree = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderTree)
    const { type, props: elementProps } = node
    if (typeof type === 'function') return renderTree(type(elementProps))
    const host = {
      type,
      props: elementProps,
      children: [],
      focus() {},
      getBoundingClientRect: () => ({ left: 120, top: 760, right: 150, bottom: 788, width: 30, height: 28 }),
      contains(candidate) {
        const walk = (current) => {
          if (current === candidate) return true
          return Array.isArray(current.children) && current.children.some((child) => walk(child))
        }
        return walk(host)
      },
      querySelector() { return null },
      closest() { return null },
    }
    if (elementProps.ref !== undefined) {
      if (typeof elementProps.ref === 'function') elementProps.ref(host)
      else if (elementProps.ref !== null && typeof elementProps.ref === 'object') elementProps.ref.current = host
    }
    const children = elementProps.children
    if (Array.isArray(children)) host.children = children.map(renderTree)
    else if (children !== undefined) host.children = renderTree(children)
    return host
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
  }
}

/** Fake primitives; Tooltip renders its child directly. */
function createFakePrimitives(runtime) {
  const h = runtime.react.createElement
  const Tooltip = ({ children }) => children
  const icon = () => h('span', {})
  return {
    Tooltip,
    IconClockOutlineRegular: icon,
    IconSearchOutlineRegular: icon,
    IconTrashOutlineRegular: icon,
  }
}

/** DOM-shaped fake with listeners, activeElement and timer support. */
function createFakeDocument() {
  const listeners = new Map()
  const head = []
  return {
    activeElement: null,
    head: { appendChild: (node) => { head.push(node) } },
    body: {},
    createElement: (tag) => ({ tag, dataset: {}, textContent: '', remove() {} }),
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
  }
}

/** Fake browser window. */
function createFakeWindow() {
  const timers = new Map()
  let nextTimer = 0
  const storage = new Map()
  return {
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => { storage.set(key, String(value)) },
      removeItem: (key) => { storage.delete(key) },
      clear: () => { storage.clear() },
    },
    setTimeout(callback) { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer },
    clearTimeout(id) { timers.delete(id) },
  }
}

/** Load the client module and return its plugin definition. */
function loadClientModule({ react, primitives, browserWindow, fakeDocument }) {
  let loaded
  const sandbox = {
    // The merged bundle only builds the feature selected by the test filter.
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-composer-history'],
    window: {
      ...browserWindow,
      __ModuleLoader__: { load(definition) { loaded = definition } },
    },
    document: fakeDocument,
    console,
    setTimeout: browserWindow.setTimeout,
    clearTimeout: browserWindow.clearTimeout,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  return loaded.factory((id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return { createPortal: (element) => element }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require ' + id)
  })
}

/** Translator for one locale dictionary. */
function translator(dictionary) {
  return (key, params = {}) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? '{' + name + '}'))
  }
}

/** One Session event record. */
function userEvent(seq, text, kind = 'user') {
  return {
    event: {
      type: 'user/message',
      seq,
      time: 1700000000000 + seq,
      data: {
        source: { kind },
        content: [{ type: 'text', text }],
      },
    },
  }
}

/**
 * Build a mounted history scenario.
 * @param {object} options - draft and prompt fixture overrides.
 * @returns {object} scenario.
 */
function scenario(options = {}) {
  const reactRuntime = createFakeReact()
  const primitives = createFakePrimitives(reactRuntime)
  const browserWindow = createFakeWindow()
  const fakeDocument = createFakeDocument()
  const writes = []
  const draft = { current: options.draft ?? '' }
  const entries = options.entries ?? [
    userEvent(1, '第一条提示词'),
    userEvent(2, '第二条提示词'),
    userEvent(3, 'runtime context', 'runtime-context'),
    { event: { type: 'assistant/message', seq: 4, data: { content: [{ type: 'text', text: 'assistant' }] } } },
    userEvent(5, '最后一条提示词'),
  ]
  const binding = { eventSource: { getSnapshot: () => ({ entries }) } }
  const shell = {
    actions: { setDraft: (text) => { writes.push(text); draft.current = text } },
    snapshot: { get draft() { return draft.current } },
  }
  const sessions = {
    binding: () => binding,
    scope: () => ({ get: (name) => name === 'conversation' ? { input: { for: () => shell } } : undefined }),
  }
  const localeRegistrations = []
  const dictionaries = {}
  const registrations = []
  const plugin = loadClientModule({ react: reactRuntime.react, primitives, browserWindow, fakeDocument })
  const ctx = {
    effect: (factory) => { const cleanup = factory(); return typeof cleanup === 'function' ? cleanup : () => {} },
    get: (name) => name === 'sessions' ? sessions : undefined,
    sessions,
    locale: {
        register: (ns, dicts) => { localeRegistrations.push({ ns, dicts }); dictionaries[ns] = dicts; return () => {} },
        bind: (namespace) => translator(dictionaries[namespace]?.zh ?? {}),
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
  const registration = registrations.find((entry) => entry.options.name === 'conversation.input.left')
  const t = translator(localeRegistrations[0].dicts.zh)
  const props = { t, ...registration.options.inject('session-a') }
  const harness = mountComponent(registration.component, props, reactRuntime)
  return { plugin, registration, registrations, localeRegistrations, fakeDocument, browserWindow, harness, t, writes, draft, shell, entries, reactRuntime }
}

/**
 * Mount the merged settings page registered by the composer-history feature.
 * The merged shell owns the settings tab slot; the feature exposes its panel
 * through module.__settingsPages as one { id, title, render } descriptor.
 * @param {object} applied - one applied scenario.
 * @returns {object} rendered settings harness and its page descriptor.
 */
function mountSettings(applied) {
  const page = applied.plugin.__settingsPages.find((entry) => entry.id === 'dsh-composer-history')
  assert(page !== undefined, 'composer-history settings page registered')
  const settingsT = translator(applied.localeRegistrations[0].dicts.zh)
  assert.equal(page.title(), settingsT('settings.title'), 'page title uses the locale dictionary')
  applied.reactRuntime.reset?.()
  const element = page.render()
  assert(element !== null && typeof element === 'object', 'page.render returns a panel element')
  const settingsHarness = mountComponent(() => page.render(), {}, applied.reactRuntime)
  return { settingsHarness, settingsPage: page, settingsT }
}

/** Find the trigger button. */
function triggerNode(harness) {
  return findOne(harness.tree, (element) => isButton(element) && element.props['data-dsh-composer-history'] === 'trigger')
}

/** Find the open dialog. */
function panelNode(harness) {
  return findOne(harness.tree, isDialog)
}

/** Build a keydown event. */
function keyEvent(key, overrides = {}) {
  const event = {
    key,
    target: overrides.target ?? null,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true },
    stopPropagation() {},
    ...overrides,
  }
  return event
}

/** Build a focusable fake composer element. */
function composerElement() {
  const owner = { getAttribute: () => 'session-a' }
  const seat = {}
  return {
    closest(selector) {
      if (selector === '[data-composer-seat]') return seat
      if (selector === '[data-conversation-session]') return owner
      return null
    },
  }
}

const menuOptionTexts = (harness) => findAll(harness.tree, isOption).map((element) => textOf(element))

// ---------------------------------------------------------------------------
// 3. Behaviour
// ---------------------------------------------------------------------------

await check('factory registers a session-scoped composer history trigger', () => {
  const { plugin, registration, localeRegistrations, registrations } = scenario()
  strict(plugin.inject.slice().sort(), ['locale', 'sessions', 'slots'])
  assert.equal(localeRegistrations[0].ns, 'composerHistory', 'locale namespace')
  assert.equal(registrations.length, 1, 'one composer registration')
  assert(!registrations.some((entry) => entry.options.name === 'settings.plugins.tab'), 'no standalone settings tab slot')
  assert.equal(registration.options.name, 'conversation.input.left', 'slot name')
  assert.equal(registration.options.locale, 'composerHistory', 'registration locale')
  assert.equal(typeof registration.options.inject, 'function', 'inject function')
  const page = plugin.__settingsPages.find((entry) => entry.id === 'dsh-composer-history')
  assert(page !== undefined, 'feature registers a merged settings page')
  assert.equal(typeof page.title, 'function', 'settings page title callback')
  assert.equal(typeof page.render, 'function', 'settings page render callback')
})

await check('history extraction keeps only real user prompts, newest first', () => {
  const { registration } = scenario()
  const actions = registration.options.inject('session-a').actions
  const history = actions.readHistory()
  equal(history.map((entry) => entry.text), ['最后一条提示词', '第二条提示词', '第一条提示词'])
  equal(history.map((entry) => entry.id), ['5', '2', '1'])
})

await check('trigger renders an accessible clock button', () => {
  const { harness, t } = scenario()
  const trigger = triggerNode(harness)
  assert.equal(trigger.props['aria-label'], t('button.label'), 'accessible label')
  assert.equal(trigger.props['aria-expanded'], false, 'closed initially')
})

await check('clicking the trigger opens a searchable prompt palette', () => {
  const { harness, t } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  const panel = panelNode(harness)
  assert(panel !== undefined, 'dialog renders')
  assert.equal(panel.props['aria-label'], t('panel.title'), 'panel title')
  equal(menuOptionTexts(harness), ['最后一条提示词', '第二条提示词', '第一条提示词'])
  assert(textOf(harness.tree).includes(t('panel.count', { count: 3 })), 'count')
})

await check('search filters history and reports no matches', () => {
  const { harness } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  const input = findOne(harness.tree, (element) => element.type === 'input')
  input.props.onChange({ target: { value: '第一条' } })
  harness.rerender()
  equal(menuOptionTexts(harness), ['第一条提示词'])
  input.props.onChange({ target: { value: 'does-not-exist' } })
  harness.rerender()
  equal(menuOptionTexts(harness), [])
  assert(textOf(harness.tree).includes('没有匹配'), 'empty search state')
})

await check('Enter inserts the selected prompt and closes the palette', () => {
  const { harness, t, writes } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  const input = findOne(harness.tree, (element) => element.type === 'input')
  const event = keyEvent('Enter')
  input.props.onKeyDown(event)
  harness.rerender()
  assert(event.defaultPrevented, 'Enter consumed')
  equal(writes, ['最后一条提示词'])
  assert.equal(findAll(harness.tree, isDialog).length, 0, 'palette closed')
  assert.equal(triggerNode(harness).props['aria-expanded'], false, 'trigger collapsed')
})

await check('clicking a prompt row inserts that prompt', () => {
  const { harness, writes } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  const options = findAll(harness.tree, isOption)
  options[1].props.onClick()
  harness.rerender()
  equal(writes, ['第二条提示词'])
})

await check('ArrowUp on an empty composer inserts the newest prompt directly', () => {
  const { harness, writes, fakeDocument, draft } = scenario()
  draft.current = ''
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const event = keyEvent('ArrowUp', { target: composer })
  fakeDocument.dispatch('keydown', event)
  harness.rerender()
  assert(event.defaultPrevented, 'shortcut consumed')
  assert.equal(findAll(harness.tree, isDialog).length, 0, 'panel stays closed')
  equal(writes, ['最后一条提示词'])
  assert.equal(draft.current, '最后一条提示词', 'draft contains the prompt')
})

await check('repeated ArrowUp steps through older prompts and stops', () => {
  const { writes, fakeDocument, draft } = scenario()
  draft.current = ''
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const press = () => fakeDocument.dispatch('keydown', keyEvent('ArrowUp', { target: composer }))
  press()
  press()
  press()
  press()
  equal(writes, ['最后一条提示词', '第二条提示词', '第一条提示词'])
  assert.equal(draft.current, '第一条提示词', 'oldest prompt stays in place')
})

await check('ArrowDown steps back toward the original draft and restores it', () => {
  const { writes, fakeDocument, draft } = scenario()
  draft.current = ''
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const up = () => fakeDocument.dispatch('keydown', keyEvent('ArrowUp', { target: composer }))
  const down = () => fakeDocument.dispatch('keydown', keyEvent('ArrowDown', { target: composer }))
  up()
  up()
  down()
  assert.equal(draft.current, '最后一条提示词', 'down moves toward the newest prompt')
  down()
  assert.equal(draft.current, '', 'down restores the empty draft')
  assert.equal(writes.at(-1), '', 'restore writes the original draft')
})

await check('editing a recalled prompt cancels the cycle instead of overwriting it', () => {
  const { writes, fakeDocument, draft } = scenario()
  draft.current = ''
  const composer = composerElement()
  fakeDocument.activeElement = composer
  fakeDocument.dispatch('keydown', keyEvent('ArrowUp', { target: composer }))
  draft.current = 'edited by the user'
  const event = keyEvent('ArrowUp', { target: composer })
  fakeDocument.dispatch('keydown', event)
  assert.equal(event.defaultPrevented, false, 'edited draft keeps the editor behavior')
  equal(writes, ['最后一条提示词'])
  assert.equal(draft.current, 'edited by the user', 'edited text is preserved')
})

await check('ArrowUp is a no-op when there is no history', () => {
  const { writes, fakeDocument, draft } = scenario({ entries: [] })
  draft.current = ''
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const event = keyEvent('ArrowUp', { target: composer })
  fakeDocument.dispatch('keydown', event)
  assert.equal(event.defaultPrevented, false, 'not consumed')
  equal(writes, [])
})

await check('ArrowUp with a non-empty draft is left to the editor', () => {
  const { harness, fakeDocument, draft } = scenario()
  draft.current = 'draft text'
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const event = keyEvent('ArrowUp', { target: composer })
  fakeDocument.dispatch('keydown', event)
  harness.rerender()
  assert.equal(event.defaultPrevented, false, 'not consumed')
  assert.equal(findAll(harness.tree, isDialog).length, 0, 'palette stays closed')
})

await check('Ctrl+ArrowUp opens the palette even with draft text', () => {
  const { harness, fakeDocument, draft } = scenario()
  draft.current = 'draft text'
  const composer = composerElement()
  fakeDocument.activeElement = composer
  const event = keyEvent('ArrowUp', { target: composer, ctrlKey: true })
  fakeDocument.dispatch('keydown', event)
  harness.rerender()
  assert(event.defaultPrevented, 'chord consumed')
  assert.equal(findAll(harness.tree, isDialog).length, 1, 'palette opened')
})

await check('Escape closes the palette', () => {
  const { harness, fakeDocument } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  assert.equal(findAll(harness.tree, isDialog).length, 1, 'opened')
  fakeDocument.dispatch('keydown', keyEvent('Escape'))
  harness.rerender()
  assert.equal(findAll(harness.tree, isDialog).length, 0, 'closed')
})

await check('clicking outside closes the palette', () => {
  const { harness, fakeDocument } = scenario()
  triggerNode(harness).props.onClick()
  harness.rerender()
  fakeDocument.dispatch('pointerdown', { target: {} })
  harness.rerender()
  assert.equal(findAll(harness.tree, isDialog).length, 0, 'closed')
})

await check('locale dictionaries contain identical key sets', () => {
  const { localeRegistrations } = scenario()
  const { zh, en } = localeRegistrations[0].dicts
  equal(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string', 'zh ' + key)
    assert.equal(typeof en[key], 'string', 'en ' + key)
  }
})

await check('shortcut listener is registered once and reused across renders', () => {
  const { harness, fakeDocument } = scenario()
  harness.rerender()
  harness.rerender()
  assert.equal(fakeDocument.listenerCount('keydown'), 1, 'single shortcut listener')
})

await check('history panel can clear the current conversation history', () => {
  const applied = scenario()
  triggerNode(applied.harness).props.onClick()
  applied.harness.rerender()
  assert(findAll(applied.harness.tree, isOption).length > 0, 'records before clear')
  const clear = findOne(applied.harness.tree, (element) => isButton(element) && element.props.className === 'dshch-clear')
  clear.props.onClick()
  applied.harness.rerender()
  const confirm = findOne(applied.harness.tree, (element) => isButton(element) && element.props.className === 'dshch-clearConfirm')
  confirm.props.onClick()
  applied.harness.rerender()
  assert.equal(findAll(applied.harness.tree, isOption).length, 0, 'panel is empty after clear')
  const stored = JSON.parse(applied.browserWindow.localStorage.getItem('dsh.composerHistory.managedSettings'))
  assert(stored.clearedSessions['session-a'] > 0, 'conversation cutoff persisted')
  const actions = applied.registration.options.inject('session-a').actions
  equal(actions.readHistory(), [])
})

await check('settings tab lists, deletes and clears recorded history', () => {
  const applied = scenario()
  triggerNode(applied.harness).props.onClick()
  applied.harness.rerender()
  const { settingsHarness } = mountSettings(applied)
  assert(textOf(settingsHarness.tree).includes('最后一条提示词'), 'newest record listed')
  const deleteButton = findOne(settingsHarness.tree, (element) => isButton(element) && element.props.className === 'dshch-settings-delete')
  deleteButton.props.onClick()
  settingsHarness.rerender()
  assert(!textOf(settingsHarness.tree).includes('最后一条提示词'), 'deleted record removed')
  const clear = findOne(settingsHarness.tree, (element) => isButton(element) && element.props.className === 'dshch-settings-clear')
  clear.props.onClick()
  settingsHarness.rerender()
  const confirm = findOne(settingsHarness.tree, (element) => isButton(element) && element.props.className === 'dshch-settings-confirm')
  confirm.props.onClick()
  settingsHarness.rerender()
  assert(textOf(settingsHarness.tree).includes('还没有可管理的历史输入'), 'empty state after clear all')
  const stored = JSON.parse(applied.browserWindow.localStorage.getItem('dsh.composerHistory.managedSettings'))
  assert(stored.clearedAt > 0, 'global cutoff persisted')
  assert.deepEqual(stored.records, [], 'record cache cleared')
  const actions = applied.registration.options.inject('session-a').actions
  equal(actions.readHistory(), [])
})

await check('settings tab previews full record text and supports expand', () => {
  const applied = scenario()
  triggerNode(applied.harness).props.onClick()
  applied.harness.rerender()
  const { settingsHarness } = mountSettings(applied)
  const toggle = findOne(settingsHarness.tree, (element) => isButton(element) && element.props.className === 'dshch-settings-toggle')
  assert.equal(toggle.props['aria-expanded'], false, 'collapsed by default')
  toggle.props.onClick()
  settingsHarness.rerender()
  const expanded = findOne(settingsHarness.tree, (element) => element.props?.className?.includes('dshch-settings-open'))
  assert(textOf(expanded).includes('最后一条提示词'), 'expanded full text')
})

await check('palette without prompts renders an empty state', () => {
  const { harness, t } = scenario({ entries: [] })
  triggerNode(harness).props.onClick()
  harness.rerender()
  assert(textOf(harness.tree).includes(t('panel.empty')), 'empty state')
  equal(menuOptionTexts(harness), [])
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function strict(actual, expected) {
  assert.deepEqual([...actual].sort(), expected.sort())
}

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
