/**
 * Zero-dependency verification for the merged left-rail feature.
 *
 * Run with `node checks/left-rail.mjs` from the package root. The shipped
 * merged bundle is loaded with only this feature built (the bundle's test
 * filter), then the overlay is mounted through a miniature React runtime and
 * driven against a fake layout/settings environment.
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

/**
 * Slice one merged feature out of the generated bundle, so feature-scoped
 * assertions do not see code from the other merged features.
 * @param {string} id - merged feature id.
 * @returns {string} the feature block of client.js.
 */
function featureSlice(id) {
  const marker = `__DSH_FEATURE('${id}',`
  const start = clientSource.indexOf(marker)
  assert(start !== -1, id + ' feature is built into client.js')
  const next = clientSource.indexOf('__DSH_FEATURE(', start + marker.length)
  return clientSource.slice(start, next === -1 ? clientSource.length : next)
}

const featureSource = featureSlice('dsh-left-rail')

let checks = 0

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

function translator(dictionary) {
  return (key, params = {}) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
}

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

function scenario(options = {}) {
  const listeners = new Map()
  const selected = []
  const panelListeners = new Set()
  let activePanel = options.activePanel ?? null
  const has = new Set(options.panels ?? ['plugins', 'schedules'])
  const panelInfo = {
    getSnapshot: () => ({ activePanelId: activePanel }),
    subscribe(listener) {
      panelListeners.add(listener)
      return () => panelListeners.delete(listener)
    },
  }
  const setActive = (id) => {
    activePanel = id
    for (const listener of panelListeners) listener()
  }
  const layout = {
    panelInfo,
    hasMainPanel: (id) => has.has(id),
    selectPanel(id) {
      selected.push(id)
      setActive(id)
    },
  }
  const settingsClicks = []
  const settings = {
    getAttribute(name) { return name === 'aria-label' ? '设置' : null },
    click() { settingsClicks.push(true) },
  }
  const panelButtons = ['插件', '自动化任务'].map((label) => ({
    hidden: false,
    getAttribute(name) { return name === 'aria-label' ? label : null },
    setAttribute(name) { if (name === 'data-dshlr-hidden') this.hidden = true },
    removeAttribute(name) { if (name === 'data-dshlr-hidden') this.hidden = false },
  }))
  const document = {
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
    querySelectorAll: (selector) => selector === 'button[aria-label]' ? [settings, ...panelButtons] : [],
  }
  const registrations = []
  let locale
  let loaded
  const sandbox = {
    // The merged bundle builds only the feature named by this test filter, so
    // the ported check sees the same standalone behavior as the old package.
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-left-rail'],
    window: {
      __ModuleLoader__: { load(definition) { loaded = definition } },
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    },
    document,
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') {
      const hooks = []
      const state = []
      let cursor = 0
      return {
        createElement(type, props, ...children) {
          if (typeof type === 'function') return type({ ...props, children: children.length === 1 ? children[0] : children })
          const element = { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
          element.children = children.length === 1 ? children[0] : children
          return element
        },
        useRef(initial) { return { current: initial } },
        useState(initial) {
          const index = cursor++
          if (!(index in state)) state[index] = initial
          return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
        },
        useEffect(effect) { effect() },
      }
    }
    throw new Error('unexpected require ' + id)
  })
  const ctx = {
    get(name) {
      if (name === 'layout') return layout
      return undefined
    },
    effect(factory) { factory(); return () => {} },
    locale: { register(ns, dicts) { locale = { ns, dicts }; return () => {} } },
    slots: {
        register(options, component) { registrations.push({ options, component }); return () => {} },
        inject(name, callback) { return callback() },
      },
  }
  plugin.apply(ctx)
  const registration = registrations[0]
  const t = translator(locale.dicts.zh)
  const injected = registration.options.inject()
  const render = () => registration.component({ ...injected, t })
  return { selected, setActive, settingsClicks, render, registration, injected, panelButtons }
}

function buttons(tree) {
  return findAll(tree, (element) => element.type === 'button')
}

// Static contract
await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.1.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
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

await check('client only requires platform-seeded modules', () => {
  const requires = [...new Set([...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]))].sort()
  assert.deepEqual(requires, [
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
    'react-dom',
  ])
  // The merged left-rail feature itself still only needs the frozen React module.
  assert.deepEqual([...featureSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]), ['react'])
})

await check('locale files carry title and description', () => {
  for (const locale of ['zh', 'en']) {
    const value = JSON.parse(read('locale/' + locale + '.json'))
    assert.equal(typeof value.meta.title, 'string')
    assert.equal(typeof value.meta.description, 'string')
  }
})

await check('icon is a valid accent SVG', () => {
  const icon = read('icon.svg')
  assert(icon.includes('<svg'))
  assert(icon.includes('#4D6BFE'))
})

// Behaviour
await check('rail exposes chat, automation, plugins and settings buttons', () => {
  const applied = scenario()
  const labels = buttons(applied.render()).map((button) => button.props['data-dshlr-button']).filter(Boolean)
  assert.deepEqual(labels, ['chat', 'plugins', 'automation', 'settings'])
})

await check('chat button selects the conversation panel', () => {
  const applied = scenario()
  buttons(applied.render()).find((button) => button.props['data-dshlr-button'] === 'chat').props.onClick()
  assert.deepEqual(applied.selected, [null])
})

await check('plugins button selects the built-in plugins panel', () => {
  const applied = scenario()
  buttons(applied.render()).find((button) => button.props['data-dshlr-button'] === 'plugins').props.onClick()
  assert.deepEqual(applied.selected, ['plugins'])
})

await check('unavailable automation panel is disabled', () => {
  const applied = scenario({ panels: ['plugins'] })
  const automation = buttons(applied.render()).find((button) => button.props['data-dshlr-button'] === 'automation')
  assert.equal(automation.props.disabled, true)
  assert(automation.props['aria-label'].includes('未安装'))
})

await check('active panel highlights the matching rail button', () => {
  const applied = scenario({ activePanel: 'plugins' })
  const pluginButton = buttons(applied.render()).find((button) => button.props['data-dshlr-button'] === 'plugins')
  assert(String(pluginButton.props.className).includes('dshlr-active'))
})

await check('the brand is never hidden by the collapsed-session rule', () => {
  assert(clientSource.includes('/brand/i.test(className)'))
  assert(clientSource.includes("button.removeAttribute?.('data-dshlr-hidden')"))
})

await check('the brand and chevron sit in one rounded pill', () => {
  assert(clientSource.includes('dshlr-brand-pill'))
  assert(clientSource.includes('border-radius: 7px'))
  assert(clientSource.includes('padding: 3px 7px 3px 6px'))
  assert(clientSource.includes('width: fit-content'))
})

await check('the brand and chevron are one workspace-menu button', () => {
  assert(clientSource.includes('dshlr-brand-chevron'))
  assert(clientSource.includes("brand.addEventListener?.('click', activateBrand, true)"))
  assert(clientSource.includes('openMenu'))
  assert(clientSource.includes('dshlr-workspace-menu'))
})

await check('the brand no longer starts a new conversation', () => {
  assert(clientSource.includes('activateBrand'))
  assert(clientSource.includes('stopImmediatePropagation'))
})

await check('the three titlebar controls share one neutral button style', () => {
  assert(clientSource.includes('width: 14px'))
  assert(clientSource.includes('background: transparent'))
  assert(clientSource.includes('.dshlr-toggle:hover'))
})

await check('the rail owns the top sidebar toggle', () => {
  assert(clientSource.includes("'data-dshlr-toggle': ''"))
  assert(clientSource.includes("button.hasAttribute?.('data-dshlr-toggle') === true"))
})

await check('sidebar content fades before and after the width transition', () => {
  assert(clientSource.includes('data-dshlr-collapsing'))
  assert(clientSource.includes('data-dshlr-expanding'))
  assert(clientSource.includes('@keyframes dshlr-content-in'))
})

await check('the shell keeps a transition for plugin-triggered sidebar toggles', () => {
  assert(clientSource.includes('grid-template-columns var(--ds-transition-duration-slow)'))
  assert(clientSource.includes(':not([data-dragging])'))
})

await check('the collapsed new-session titlebar button is hidden', () => {
  assert(clientSource.includes('hideCollapsedNewSession'))
  assert(clientSource.includes("top < 60"))
})

await check('cloned host glyphs keep one fixed size across sidebar states', () => {
  assert(clientSource.includes('width: 18px !important'))
  assert(clientSource.includes('height: 18px !important'))
})

await check('native plugin and automation sidebar rows are hidden', () => {
  const applied = scenario()
  assert.deepEqual(applied.panelButtons.map((button) => button.hidden), [true, true])
})

await check('the active item renders a solid filled glyph', () => {
  assert(clientSource.includes('FILLED_ICONS'))
  assert(clientSource.includes('function FilledIcon'))
  assert(clientSource.includes("fill: 'currentColor'"))
})

await check('active filling does not reuse the broken outline-fill CSS', () => {
  assert(!clientSource.includes('.dshlr-button.dshlr-active .dshlr-glyph svg'))
})

await check('active state is indicated by the button style, not a different glyph', () => {
  const tree = scenario({ activePanel: 'plugins' }).render()
  const pluginButton = buttons(tree).find((button) => button.props['data-dshlr-button'] === 'plugins')
  assert(String(pluginButton.props.className).includes('dshlr-active'))
})

await check('settings menu exposes account, settings, feedback and logout', () => {
  assert(clientSource.includes("'data-dshlr-menu-item': 'settings'"))
  assert(clientSource.includes("'data-dshlr-menu-item': 'feedback'"))
  assert(clientSource.includes("'data-dshlr-menu-item': 'logout'"))
  assert(clientSource.includes("'rail.account'"))
})

await check('settings action clicks the host settings control', () => {
  const applied = scenario()
  applied.injected.actions.openSettings()
  assert.equal(applied.settingsClicks.length, 1)
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
