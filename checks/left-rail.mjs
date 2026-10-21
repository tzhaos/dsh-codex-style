/** Host adapter behavior; real primitives and geometry are exercised by review-fixture. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let checks = 0
async function check(name, body) {
  try { await body(); checks += 1; console.log('ok ' + name) }
  catch (error) { process.exitCode = 1; console.error('FAIL ' + name + '\n     ' + error.stack) }
}
class Node {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes)); this.children = []; this.listeners = new Map()
    this.classes = new Set(); this.classList = { add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x) }
    this.dataset = {}; this.clicks = 0
  }
  getAttribute(key) { return this.attributes.get(key) ?? null }
  setAttribute(key, value) { this.attributes.set(key, value) }
  removeAttribute(key) { this.attributes.delete(key) }
  addEventListener(key, fn) { this.listeners.set(key, fn) }
  removeEventListener(key, fn) { if (this.listeners.get(key) === fn) this.listeners.delete(key) }
  appendChild(child) { child.parentElement = this; this.children.push(child) }
  querySelector() { return this.identity ?? null }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this) }
  click() { this.clicks += 1 }
}
function fixture({ panels = ['plugins', 'schedules'], active = null, preferenceStatus = 'ready', mutate } = {}) {
  const brand = new Node({ 'aria-label': '新建会话' }); brand.identity = new Node()
  const settings = new Node({ 'aria-label': '账号菜单' })
  const rows = ['插件', '自动化任务'].map((label) => new Node({ 'aria-label': label }))
  const root = new Node(); const disposers = []; const registrations = []
  const document = { documentElement: root, body: new Node(), head: new Node(), createElement: () => new Node(),
    querySelector: (selector) => selector.includes('_logoRow') ? brand : selector.includes('_settingsArea') ? settings : null,
    querySelectorAll: () => rows }
  const selected = []; const subscribers = new Set(); let current = active; let definition; let dictionary
  const layout = { panelInfo: { getSnapshot: () => ({ activePanelId: current }), subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) } },
    hasMainPanel: (id) => panels.includes(id), selectPanel: (id) => { current = id; selected.push(id); for (const fn of subscribers) fn() } }
  const workspaces = { items: [{ workspaceId: 'w1', path: 'C:/project', title: 'project', sessionIds: ['s1'] }], archivedSessionIds: [] }
  const opened = []
  const preferenceListeners = new Set(), writes = []
  let preferences = { status: preferenceStatus, writable: preferenceStatus === 'ready', value: { transcriptView: 'standard', collapseTiming: 'completion', performanceUsage: 'compact', linkOpening: 'sidebar' } }
  const form = {
    getSnapshot: () => preferences,
    subscribe: (fn) => { preferenceListeners.add(fn); return () => preferenceListeners.delete(fn) },
    mutate: async (patch) => {
      writes.push(patch)
      if (mutate) return mutate(patch)
      const value = { ...preferences.value }
      for (const operation of patch) value[operation.path[0]] = operation.value
      preferences = { ...preferences, value }
      for (const fn of preferenceListeners) fn()
      return true
    },
  }
  const workspace = { workspaces: { list: { getSnapshot: () => workspaces, subscribe: () => () => {} } },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: {} } }) } }, openSession: async (id) => opened.push(id) }
  const react = { Fragment: 'fragment', useId: () => 'fixture-icon', createElement(type, props, ...children) {
    const next = { ...props, children: children.flat() }
    return typeof type === 'function' ? type(next) : { type, props: next }
  }, useState: (value) => [typeof value === 'function' ? value() : value, () => {}], useEffect: (fn) => { const off = fn(); if (off) disposers.push(off) } }
  const primitives = { Tooltip: ({ children }) => children, Menu: (props) => ({ type: 'Menu', props }) }
  for (const name of ['IconQueueOutlineRegular', 'IconQueueOutlineMedium', 'IconClockOutlineRegular', 'IconClockOutlineMedium', 'IconPluginPinwheelOutlineRegular', 'IconPluginPinwheelOutlineMedium', 'IconSettingsOutlineRegular', 'IconSettingsOutlineMedium', 'IconChevronDownOutlineRegular']) primitives[name] = () => ({ type: name })
  vm.runInNewContext(source, { __DSH_CODEX_STYLE_FEATURES__: ['dsh-left-rail'], window: { __ModuleLoader__: { load: (value) => { definition = value } } },
    document, MutationObserver: class { observe() {} disconnect() {} }, console })
  const plugin = definition.factory((id) => id === 'react' ? react : id === 'react-dom' ? { createPortal: (node) => node } : primitives)
  const services = { layout, configForms: { get: (id) => { assert.equal(id, 'ui-chat'); return form } }, uiWorkspace: workspace, uiSession: { current: { value: 's0' } } }
  const t = (key, params = {}) => (dictionary?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name])
  plugin.apply({ get: (name) => services[name], effect: (fn) => { const off = fn(); if (off) disposers.push(off); return () => {} },
    locale: { register: (_ns, dicts) => { dictionary = dicts.zh; return () => {} }, bind: () => t },
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { registrations.push({ options, component }); return () => {} } } })
  const registration = registrations[0]; const injected = registration.options.inject()
  const render = () => registration.component({ ...injected, t })
  return { root, brand, settings, rows, selected, opened, writes, form, preferenceListeners, injected, render, dispose: () => disposers.reverse().forEach((fn) => fn()) }
}
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((value) => all(value, predicate))
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)]
}
const button = (app, name) => all(app.render(), (node) => node.props?.['data-dshlr-button'] === name)[0]

await check('rail uses host layout navigation and panel availability', () => {
  const app = fixture({ panels: ['plugins'] })
  button(app, 'chat').props.onClick(); button(app, 'plugins').props.onClick()
  assert.deepEqual(app.selected, [null, 'plugins'])
  assert.equal(button(app, 'automation').props.disabled, true)
})
await check('active panel exposes an accessible current-page state', () => {
  const app = fixture({ active: 'plugins' })
  assert.equal(button(app, 'plugins').props['aria-current'], 'page')
  assert.equal(button(app, 'chat').props['aria-current'], undefined)
})
await check('brand opens display preferences without navigation or creating a session', () => {
  const app = fixture(); const event = { preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true } }
  app.brand.listeners.get('click')(event)
  assert.equal(event.stopped, true)
  assert.equal(app.brand.getAttribute('aria-label'), '工作模式')
  assert.equal(app.injected.adapter.snapshot().open, true)
  assert.equal(app.brand.getAttribute('aria-expanded'), 'true')
  app.injected.adapter.close(); assert.equal(app.brand.getAttribute('aria-expanded'), 'false')
})
await check('settings keeps the actual native launcher and its menu anchor', () => {
  const app = fixture()
  assert.equal(app.settings.getAttribute('data-dshlr-button'), 'settings')
  app.injected.adapter.openSettings(); assert.equal(app.settings.clicks, 1)
  assert.equal(app.injected.adapter.snapshot().launcher, app.settings)
})
await check('Code atomically updates native display fields and preserves unrelated settings', async () => {
  const app = fixture()
  assert.equal(await app.injected.display.select('code'), true)
  assert.equal(app.writes.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(app.writes[0])), [
    { op: 'set', path: ['transcriptView'], value: 'detailed' },
    { op: 'set', path: ['collapseTiming'], value: 'next-input' },
  ])
  assert.equal(app.form.getSnapshot().value.performanceUsage, 'compact')
  assert.equal(app.form.getSnapshot().value.linkOpening, 'sidebar')
  assert.deepEqual(app.opened, [])
})
await check('the menu contains only Work and Code and retains the accepted selection', () => {
  const app = fixture()
  app.brand.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() {} })
  const menu = all(app.render(), (node) => node.type === 'Menu')[0]
  assert.deepEqual(Array.from(menu.props.items, (item) => item.id), ['work', 'code'])
  assert.deepEqual(Array.from(menu.props.selectedIds), ['work'])
  assert.equal(menu.props.footer, undefined)
  assert.equal(app.writes.length, 0, 'opening does not migrate existing preferences')
})
await check('Work and Code round trip, unchanged selections do not write and old actions are rejected', async () => {
  const app = fixture()
  assert.equal(await app.injected.display.select('work'), true)
  assert.equal(app.injected.display.getSnapshot().mode, 'compact')
  assert.equal(app.injected.display.getSnapshot().timing, 'completion')
  assert.equal(await app.injected.display.select('code'), true)
  assert.equal(app.injected.display.getSnapshot().profile, 'code')
  assert.equal(await app.injected.display.select('code'), true)
  assert.equal(app.writes.length, 2)
  assert.equal(await app.injected.display.select('work'), true)
  assert.equal(app.injected.display.getSnapshot().profile, 'work')
  for (const id of ['mode:compact', 'timing:completion', 'preset:verbose', 'toString'])
    assert.equal(await app.injected.display.select(id), false)
})
await check('loading preferences cannot be overwritten and failures retain accepted values', async () => {
  const loading = fixture({ preferenceStatus: 'loading' })
  assert.equal(await loading.injected.display.select('work'), false)
  assert.equal(loading.writes.length, 0)
  for (const mutate of [async () => false, async () => { throw new Error('disconnected') }]) {
    const app = fixture({ mutate })
    assert.equal(await app.injected.display.select('code'), false)
    assert.equal(app.injected.display.getSnapshot().mode, 'standard')
    assert.equal(app.injected.display.getSnapshot().failed, true)
    assert.equal(app.injected.display.getSnapshot().saving, false)
  }
})
await check('a pending write cannot be duplicated and disposal releases only our subscription', async () => {
  let resolve
  const app = fixture({ mutate: () => new Promise((done) => { resolve = done }) })
  const saving = app.injected.display.select('work')
  assert.equal(await app.injected.display.select('code'), false)
  assert.equal(app.writes.length, 1)
  app.dispose()
  assert.equal(app.preferenceListeners.size, 0)
  resolve(true)
  await saving
})
await check('disposal restores native attributes, listeners, visibility and geometry', () => {
  const app = fixture()
  assert(app.rows.every((row) => row.getAttribute('data-dshlr-hidden') === ''))
  app.dispose()
  assert.equal(app.brand.getAttribute('aria-label'), '新建会话')
  assert.equal(app.brand.getAttribute('aria-haspopup'), null)
  assert.equal(app.brand.listeners.size, 0)
  assert.equal(app.settings.getAttribute('aria-label'), '账号菜单')
  assert.equal(app.settings.getAttribute('data-dshlr-button'), null)
  assert(app.rows.every((row) => row.getAttribute('data-dshlr-hidden') === null))
  assert.equal(app.root.getAttribute('data-dshlr-active'), null)
})
console.log(`\n${process.exitCode ? 'some checks failed' : 'all checks passed (' + checks + ')'}`)
