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
/** Feature hooks from the unbundled source, used for the account/update helpers. */
let buildFeature
vm.runInNewContext(fs.readFileSync(new URL('../src/navigation/left-rail.js', import.meta.url), 'utf8'), {
  __DSH_FEATURE: (_id, factory) => { buildFeature = factory },
  document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
})
const featureHooks = (() => {
  const React = {
    Fragment: 'fragment', useId: () => 'fixture-icon',
    createElement: () => null, useState: (value) => [value, () => {}], useEffect: () => {},
  }
  const primitives = { Tooltip: ({ children }) => children, Menu: () => null, IconChevronDownOutlineRegular: () => null }
  const env = { createNavigationIcon: () => () => null, presentationCSS: '', navigationIconsCSS: '' }
  return buildFeature(
    (id) => id === 'react' ? React : id === 'react-dom' ? { createPortal: (node) => node } : primitives,
    env,
  ).__test
})()
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fakeRemoteAccount(options = {}) {
  const calls = { state: 0, profile: 0, balance: 0, tasks: 0, signOut: [], profileMeta: null }
  const state = options.state ?? {
    status: 'credential-stored',
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  }
  return {
    calls,
    account: {
      async getState() { calls.state += 1; return { ok: true, value: state } },
      async getProfile(meta) {
        calls.profile += 1; calls.profileMeta = meta
        return options.profile ?? { ok: true, value: { status: 'ready', value: { id: '1', name: 'Ncst Tian', contact: '24*****17@qq.com', avatarUrl: null } } }
      },
      async getBalance() {
        calls.balance += 1
        return options.balance ?? { ok: true, value: { status: 'ready', value: [{ currency: 'USD', balance: '0' }, { currency: 'CNY', balance: '-0.01' }], bonusWallets: [] } }
      },
      async hasRunningAccountTasks() { calls.tasks += 1; return { ok: true, value: options.running === true } },
      async signOut(meta) { calls.signOut.push(meta); return { ok: true, value: { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' } } } },
    },
  }
}
function accountContext(remoteAccount) {
  return {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
    remote: { account: remoteAccount },
  }
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
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
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
// ---------------------------------------------------------------------------
// Account launcher and Desktop update button
// ---------------------------------------------------------------------------
await check('wallet text keeps the Platform formatting for both currencies', () => {
  assert.equal(featureHooks.formatWallet('0', 'CNY'), '¥0.00')
  assert.equal(featureHooks.formatWallet('12.345', 'CNY'), '¥12.34')
  assert.equal(featureHooks.formatWallet('1234.5', 'USD'), '$1,234.50')
  assert.equal(featureHooks.formatWallet('0.005', 'CNY'), '<¥0.01')
  assert.equal(featureHooks.formatWallet('-0.005', 'CNY'), '-¥0.01')
  assert.equal(featureHooks.formatWallet('-12.3', 'USD'), '-$12.30')
  assert.equal(featureHooks.formatWallet(undefined, 'CNY'), '¥0')
  assert.equal(
    featureHooks.walletSummary([{ currency: 'USD', balance: '0' }, { currency: 'CNY', balance: '-0.01' }, { currency: 'CNY', balance: 5 }]),
    '$0.00 · -¥0.01',
  )
  assert.equal(featureHooks.walletSummary(null), '')
  assert.equal(featureHooks.walletSummary([]), '')
})
await check('avatar fallback initials derive from the profile name', () => {
  assert.equal(featureHooks.accountInitials('Ncst Tian'), 'NT')
  assert.equal(featureHooks.accountInitials('ncsttian'), 'NC')
  assert.equal(featureHooks.accountInitials('  '), 'DS')
  assert.equal(featureHooks.accountInitials(undefined), 'DS')
})
await check('the update button follows every Desktop update phase and hides when idle', () => {
  const t = (key, params = {}) => key + JSON.stringify(params)
  const view = (snapshot) => JSON.parse(JSON.stringify(featureHooks.updateView(snapshot, t)))
  assert.deepEqual(view({ phase: 'idle' }), { visible: false })
  assert.deepEqual(view(null), { visible: false })
  const available = view({ phase: 'available', version: '1.4.0' })
  assert.equal(available.visible, true)
  assert.equal(available.kind, 'download')
  assert(available.label.includes('"version":"1.4.0"'))
  assert.equal(featureHooks.updateView({ phase: 'downloading', percent: 42 }, t).kind, 'progress')
  assert.equal(featureHooks.updateView({ phase: 'verifying', percent: 100 }, t).kind, 'progress')
  assert.equal(featureHooks.updateView({ phase: 'ready', version: '1.4.0' }, t).kind, 'install')
  assert.equal(featureHooks.updateView({ phase: 'installing' }, t).kind, 'installing')
  assert.equal(featureHooks.updateView({ phase: 'error' }, t).kind, 'error')
})
await check('signed-in account identity loads profile, wallet and usage links', async () => {
  const remote = fakeRemoteAccount()
  const controller = featureHooks.createAccountController(accountContext(remote.account))
  const stop = controller.start()
  await tick(); await tick()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.signedIn, true)
  assert.equal(snapshot.profile.name, 'Ncst Tian')
  assert.equal(snapshot.profile.contact, '24*****17@qq.com')
  assert.equal(snapshot.balance.value[0].currency, 'USD')
  assert.equal(snapshot.links.usageUrl, 'https://platform.deepseek.com/usage')
  assert.equal(remote.calls.profileMeta.locale, 'zh-CN')
  assert.equal(typeof remote.calls.profileMeta.version, 'string')
  assert.equal(typeof remote.calls.profileMeta.timezoneOffsetSeconds, 'number')
  assert.equal(await controller.hasRunningTasks(), false)
  stop()
  controller.dispose()
})
await check('signed-out and unavailable accounts keep the native settings launcher', async () => {
  const remote = fakeRemoteAccount({ state: { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' } } })
  const signedOut = featureHooks.createAccountController(accountContext(remote.account))
  const stop = signedOut.start()
  await tick(); await tick()
  assert.equal(signedOut.getSnapshot().signedIn, false)
  assert.equal(remote.calls.profile, 0, 'a signed-out account does not read the profile')
  stop()
  signedOut.dispose()
  const unavailable = featureHooks.createAccountController({
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
    get: () => undefined,
  })
  unavailable.start()
  await tick()
  assert.equal(unavailable.getSnapshot().phase, 'unavailable')
  assert.equal(unavailable.getSnapshot().signedIn, false)
  unavailable.dispose()
})
await check('sign out carries the client metadata and clears the identity', async () => {
  const remote = fakeRemoteAccount({ running: true })
  const controller = featureHooks.createAccountController(accountContext(remote.account))
  controller.start()
  await tick(); await tick()
  assert.equal(await controller.hasRunningTasks(), true)
  await controller.signOut()
  assert.equal(remote.calls.signOut.length, 1)
  assert.equal(remote.calls.signOut[0].locale, 'zh-CN')
  assert.equal(controller.getSnapshot().signedIn, false)
  assert.equal(controller.getSnapshot().profile, null)
  controller.dispose()
})
await check('the account launcher and update button ship with the merged bundle', () => {
  for (const marker of [
    'dshlr-accountTrigger',
    'dshlr-accountMenuNative',
    'dshlr-accountValueRow',
    'dshlr-updateButton',
    'data-dshlr-account',
    'dshlr-accountConfirmTitle',
    'account.signOutTitle',
  ]) assert(source.includes(marker), 'account marker ' + marker)
  assert(source.includes('ctx.remote?.account'), 'account reads the remote service')
  assert(source.includes('getBalance(client)'), 'account reads the wallet balance')
  assert(source.includes('hasRunningAccountTasks()'), 'sign out checks running tasks')
  assert(source.includes('globalThis.dshDesktop?.updates'), 'update button uses the Desktop updater')
  assert(source.includes('api.status?.()'), 'update button reads the initial updater status')
})
console.log(`\n${process.exitCode ? 'some checks failed' : 'all checks passed (' + checks + ')'}`)
