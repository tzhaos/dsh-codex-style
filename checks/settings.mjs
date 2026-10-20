/**
 * Checks for the merged settings shell: the single Settings → Codex Style
 * section, its per-feature tabs, the shared enable switch and its locale copy.
 *
 * The shipped bundle is loaded with only the shell feature built (the bundle's
 * test filter), rendered through a miniature React/hooks runtime, and driven by
 * clicking the elements the real section renders.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { FEATURE_ORDER } from '../scripts/build-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const clientSource = read('client.js')
const manifest = JSON.parse(read('package.json'))

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
  return textOf(element.props?.children)
}

/** Find every rendered element matching a predicate. */
function findAll(root, predicate) {
  const found = []
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (predicate(node)) found.push(node)
    visit(node.props?.children)
  }
  visit(root)
  return found
}

/** Find one rendered element matching a predicate. */
function findOne(root, predicate) {
  const matches = findAll(root, predicate)
  assert(matches.length >= 1, 'expected one match, found ' + matches.length)
  return matches[0]
}

/**
 * Miniature React runtime: createElement, hooks and function components.
 * @returns {{ React: object, render: (component: Function, props: object) => object }} runtime.
 */
function createRuntime() {
  const instances = new Map()
  let current = null

  const React = {
    createElement(type, props, ...children) {
      const childList = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: { ...(props ?? {}), children: childList } }
    },
    useState(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        instance.hooks[index] = typeof next === 'function' ? next(instance.hooks[index]) : next
      }
      return [instance.hooks[index], set]
    },
    useRef(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = { current: initial }
      return instance.hooks[index]
    },
    useId() {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = 'id-' + index + '-' + instances.size
      return instance.hooks[index]
    },
  }

  /** Render one node tree, invoking function components with hook context. */
  function renderNode(node) {
    if (node === null || node === undefined) return node
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderNode)
    if (typeof node.type === 'function') {
      let instance = instances.get(node.type)
      if (instance === undefined) {
        instance = { hooks: [], index: 0 }
        instances.set(node.type, instance)
      }
      instance.index = 0
      const previous = current
      current = instance
      const output = node.type(node.props)
      current = previous
      return renderNode(output)
    }
    return { type: node.type, props: { ...node.props, children: renderNode(node.props.children) } }
  }

  return {
    React,
    render(component, props) {
      return renderNode(React.createElement(component, props))
    },
  }
}

/**
 * Load the shipped bundle with only the settings shell built.
 * @param {object} React - miniature React runtime.
 * @returns {object} loaded bundle and mount helpers.
 */
function loadBundle(React) {
  const registrations = []
  const storage = new Map()
  const styles = []
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-codex-style.settings'],
    window: {
      __ModuleLoader__: { load: (definition) => registrations.push(definition) },
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
    },
    document: {
      createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
      head: { appendChild: (tag) => styles.push(tag) },
      querySelector: () => null,
    },
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  assert.equal(registrations.length, 1, 'one bundle registration')
  const module = registrations[0].factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react-dom') return { createPortal: (node) => node }
    throw new Error('unexpected require ' + specifier)
  })
  return { module, sandbox, storage, styles, registration: registrations[0] }
}

/**
 * Mount the settings shell on a fake client context.
 * @returns {object} mount, dictionaries, render helpers and captured state.
 */
function mount(language = 'zh') {
  const runtime = createRuntime()
  const loaded = loadBundle(runtime.React)
  const dictionaries = {}
  const registered = []
  const effects = []
  let activeLanguage = language

  const ctx = {
    effect(factory) { effects.push(factory()) },
    locale: {
      register(namespace, dicts) { dictionaries[namespace] = dicts },
      bind(namespace) {
        return (key, vars) => {
          const dict = (dictionaries[namespace] ?? {})[activeLanguage] ?? {}
          let value = dict[key]
          if (typeof value !== 'string') return key
          if (vars !== undefined) {
            for (const [name, replacement] of Object.entries(vars)) value = value.split('{' + name + '}').join(String(replacement))
          }
          return value
        }
      },
    },
    slots: {
      inject(name, callback) { return callback() },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
  }

  loaded.module.apply(ctx)
  const section = registered.find((entry) => entry.options.name === 'settings.section')
  assert(section !== undefined, 'settings.section registered')
  const t = ctx.locale.bind('codexStyle')

  return {
    module: loaded.module,
    dictionaries,
    storage: loaded.storage,
    styles: loaded.styles,
    section,
    effects,
    t,
    setLanguage(next) { activeLanguage = next },
    render() { return runtime.render(section.component, { t }) },
  }
}

const tabsOf = (tree) => findAll(tree, (node) => node.props?.role === 'tab')
const switchOf = (tree) => findOne(tree, (node) => node.props?.role === 'switch')

// ---------------------------------------------------------------------------
// Registration and copy
// ---------------------------------------------------------------------------

await check('shell registers one settings section on a locale namespace', () => {
  const mounted = mount()
  assert.equal(mounted.section.options.id, 'codex-style')
  assert.equal(mounted.section.options.order, 70)
  assert.equal(typeof mounted.section.options.label, 'function')
  assert.equal(mounted.section.options.locale, 'codexStyle')
  assert.equal(mounted.section.options.label(), 'Codex 风格')
  mounted.setLanguage('en')
  assert.equal(mounted.section.options.label(), 'Codex Style')
})

await check('shell registers zh and en dictionaries for every feature page', () => {
  const mounted = mount()
  const dicts = mounted.dictionaries.codexStyle
  assert(dicts !== undefined, 'codexStyle dictionaries')
  for (const key of ['settings.nav', 'settings.title', 'settings.intro', 'settings.tabs', 'settings.restart', 'settings.dataHint']) {
    assert.equal(typeof dicts.zh[key], 'string', 'zh ' + key)
    assert.equal(typeof dicts.en[key], 'string', 'en ' + key)
  }
  for (const id of FEATURE_ORDER) {
    for (const suffix of ['title', 'summary', 'note']) {
      assert.equal(typeof dicts.zh['feature.' + id + '.' + suffix], 'string', 'zh ' + id + ' ' + suffix)
      assert.equal(typeof dicts.en['feature.' + id + '.' + suffix], 'string', 'en ' + id + ' ' + suffix)
    }
  }
})

await check('manifest exposes the merged settings dependency, not the old tab slot package', () => {
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  assert(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
})

// ---------------------------------------------------------------------------
// Rendered section
// ---------------------------------------------------------------------------

await check('section renders a heading, intro and one tab per merged feature', () => {
  const mounted = mount()
  const tree = mounted.render()
  const heading = findOne(tree, (node) => node.type === 'h2')
  assert.equal(textOf(heading), 'Codex 风格插件')
  const tabs = tabsOf(tree)
  assert.equal(tabs.length, FEATURE_ORDER.length)
  for (const [index, id] of FEATURE_ORDER.entries()) {
    assert(tabs[index].props.id.includes('-' + id), 'tab ' + index + ' owns ' + id)
    assert.equal(typeof tabs[index].props.onClick, 'function')
  }
  assert.equal(tabs[0].props['aria-selected'], 'true')
  assert.equal(tabs[1].props['aria-selected'], 'false')
  assert.equal(tabs[0].props.tabIndex, 0)
  assert.equal(tabs[1].props.tabIndex, -1)
})

await check('every tab carries a distinct localized title', () => {
  const mounted = mount()
  const tree = mounted.render()
  const labels = tabsOf(tree).map((tab) => textOf(tab))
  assert.equal(new Set(labels).size, FEATURE_ORDER.length)
  assert.equal(labels[0], '侧边栏分区')
  assert.equal(labels[FEATURE_ORDER.indexOf('dsh-queue-withdraw')], '排队消息')
  mounted.setLanguage('en')
  const english = tabsOf(mounted.render()).map((tab) => textOf(tab))
  assert.equal(english[0], 'Sidebar sections')
  assert.equal(english[FEATURE_ORDER.indexOf('dsh-quick-fork')], 'Selection fork')
})

await check('the first tab shows its summary, enable switch and data note', () => {
  const mounted = mount()
  const tree = mounted.render()
  const panel = findOne(tree, (node) => node.props?.role === 'tabpanel')
  assert.equal(panel.props['aria-labelledby'], tabsOf(tree)[0].props.id)
  const title = findOne(tree, (node) => node.type === 'h3')
  assert.equal(textOf(title), '侧边栏分区')
  const notes = findAll(tree, (node) => node.type === 'p' && textOf(node).includes('localStorage'))
  assert(notes.length >= 1, 'data note rendered')
  const control = switchOf(tree)
  assert.equal(control.props['aria-checked'], 'true')
  assert.equal(textOf(control), '已启用')
})

await check('clicking a tab switches the panel, the switch and the note', () => {
  const mounted = mount()
  let tree = mounted.render()
  const quickForkIndex = FEATURE_ORDER.indexOf('dsh-quick-fork')
  tabsOf(tree)[quickForkIndex].props.onClick()
  tree = mounted.render()
  const tabs = tabsOf(tree)
  assert.equal(tabs[quickForkIndex].props['aria-selected'], 'true')
  assert.equal(tabs[0].props['aria-selected'], 'false')
  assert.equal(textOf(findOne(tree, (node) => node.type === 'h3')), '划选复创')
  assert.equal(textOf(switchOf(tree)), '已启用')
  assert(textOf(findOne(tree, (node) => node.props?.role === 'tabpanel')).includes('精简面板'))
})

await check('keyboard arrows and Home/End move the active tab', () => {
  const mounted = mount()
  let tree = mounted.render()
  const preventDefault = () => {}
  tabsOf(tree)[0].props.onKeyDown({ key: 'ArrowRight', preventDefault })
  tree = mounted.render()
  assert.equal(tabsOf(tree)[1].props['aria-selected'], 'true')
  tabsOf(tree)[1].props.onKeyDown({ key: 'End', preventDefault })
  tree = mounted.render()
  assert.equal(tabsOf(tree)[FEATURE_ORDER.length - 1].props['aria-selected'], 'true')
  tabsOf(tree)[FEATURE_ORDER.length - 1].props.onKeyDown({ key: 'ArrowRight', preventDefault })
  tree = mounted.render()
  assert.equal(tabsOf(tree)[0].props['aria-selected'], 'true', 'ArrowRight wraps')
  tabsOf(tree)[0].props.onKeyDown({ key: 'ArrowLeft', preventDefault })
  tree = mounted.render()
  assert.equal(tabsOf(tree)[FEATURE_ORDER.length - 1].props['aria-selected'], 'true', 'ArrowLeft wraps')
})

await check('features are enabled by default', () => {
  const mounted = mount()
  const tree = mounted.render()
  assert.equal(switchOf(tree).props['aria-checked'], 'true')
  assert.equal(mounted.storage.size, 0)
})

await check('the switch persists the per-feature preference and renders the disabled state', () => {
  const mounted = mount()
  let tree = mounted.render()
  switchOf(tree).props.onClick()
  tree = mounted.render()
  const storedKey = 'dsh.codexStyle.features'
  assert(mounted.storage.has(storedKey), 'preference key written')
  assert.deepEqual(JSON.parse(mounted.storage.get(storedKey)), { 'dsh-sidebar-sections': false })
  const control = switchOf(tree)
  assert.equal(control.props['aria-checked'], 'false')
  assert.equal(textOf(control), '已停用')
  assert(textOf(findOne(tree, (node) => node.props?.role === 'tabpanel')).includes('该子插件当前已停用'))
})

await check('re-enabling a feature writes the enabled value back', () => {
  const mounted = mount()
  let tree = mounted.render()
  switchOf(tree).props.onClick()
  tree = mounted.render()
  switchOf(tree).props.onClick()
  tree = mounted.render()
  assert.deepEqual(JSON.parse(mounted.storage.get('dsh.codexStyle.features')), { 'dsh-sidebar-sections': true })
  assert.equal(switchOf(tree).props['aria-checked'], 'true')
})

await check('the switch target follows the active tab', () => {
  const mounted = mount()
  let tree = mounted.render()
  const queueIndex = FEATURE_ORDER.indexOf('dsh-queue-withdraw')
  tabsOf(tree)[queueIndex].props.onClick()
  tree = mounted.render()
  switchOf(tree).props.onClick()
  assert.deepEqual(JSON.parse(mounted.storage.get('dsh.codexStyle.features')), { 'dsh-queue-withdraw': false })
})

await check('a malformed preference document falls back to all-enabled', () => {
  const mounted = mount()
  mounted.storage.set('dsh.codexStyle.features', '{not json')
  const tree = mounted.render()
  assert.equal(switchOf(tree).props['aria-checked'], 'true')
})

await check('section titles and notes follow the active locale', () => {
  const mounted = mount('en')
  const tree = mounted.render()
  assert.equal(textOf(findOne(tree, (node) => node.type === 'h2')), 'Codex Style plugin')
  assert.equal(textOf(switchOf(tree)), 'Enabled')
  const restart = findAll(tree, (node) => node.type === 'p').map(textOf).find((value) => value.includes('restart'))
  assert(typeof restart === 'string', 'restart hint in English')
})

await check('shell injects its stylesheet and cleans up effects', () => {
  const mounted = mount()
  assert(mounted.styles.length === 1, 'one style tag')
  const css = mounted.styles[0].textContent
  for (const marker of ['.dshcs-section', '.dshcs-tabs', '.dshcs-tab', '.dshcs-switchOn', '.dshcs-note']) {
    assert(css.includes(marker), marker + ' styled')
  }
  assert.equal(mounted.effects.length, 3, 'dictionaries, styles and section effects')
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
