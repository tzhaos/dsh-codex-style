/**
 * Zero-dependency verification for the merged nav-back-forward feature.
 *
 * Run with `node checks/nav-back-forward.mjs` from the package root. The
 * shipped merged bundle is loaded with only this feature built (the bundle's
 * test filter), then the real overlay is mounted through a miniature React
 * runtime and driven against a fake `uiSession`/`uiWorkspace`.
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

const featureSource = featureSlice('dsh-nav-back-forward')

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
  return (key) => dictionary[key] ?? key
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

function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  return textOf(element.props?.children)
}

function scenario(options = {}) {
  const listeners = new Map()
  let value
  const sessionListeners = new Set()
  const opened = []
  const current = {
    get value() { return value },
    subscribe(listener) {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
  }
  const setSession = (next) => {
    value = next
    for (const listener of sessionListeners) listener()
  }
  const uiSession = { current }
  const uiWorkspace = {
    openSession(sessionId) {
      opened.push(sessionId)
      if (options.openSession) return options.openSession(sessionId)
      return Promise.resolve()
    },
  }
  const document = {
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
  }
  const registrations = []
  let locale
  let loaded
  const sandbox = {
    // The merged bundle builds only the feature named by this test filter, so
    // the ported check sees the same standalone behavior as the old package.
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-nav-back-forward'],
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
      let cursor = 0
      return {
        createElement(type, props, ...children) {
          const element = { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
          element.children = children.length === 1 ? children[0] : children
          return element
        },
        useRef(initial) { return { current: initial } },
        useState(initial) {
          const index = cursor++
          if (!(index in hooks)) hooks[index] = initial
          return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
        },
        useEffect(effect) { effect() },
      }
    }
    throw new Error('unexpected require ' + id)
  })
  const ctx = {
    get(name) {
      if (name === 'uiSession') return uiSession
      if (name === 'uiWorkspace') return uiWorkspace
      return undefined
    },
    effect(factory) { factory(); return () => {} },
    locale: {
      register(ns, dicts) { locale = { ns, dicts }; return () => {} },
    },
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
  return { setSession, opened, registration, render, listeners, nav: injected.nav }
}

function buttons(tree) {
  return findAll(tree, (element) => element.type === 'button')
}

// Static contract
await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.3.2')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const dependency of [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-workspace',
  ]) assert(manifest.dsh.client.inject.includes(dependency), 'inject includes ' + dependency)
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
  // The merged nav-back-forward feature itself still only needs the frozen React module.
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
await check('session switches build back and forward history', async () => {
  const applied = scenario()
  applied.setSession('s1')
  applied.setSession('s2')
  applied.setSession('s3')
  const tree = applied.render()
  const [back, forward] = buttons(tree)
  assert.equal(back.props.disabled, false, 'back enabled')
  assert.equal(forward.props.disabled, true, 'forward disabled at the tip')
  back.props.onClick()
  assert.deepEqual(applied.opened, ['s2'])
})

await check('forward returns to the session after Back', async () => {
  const applied = scenario()
  applied.setSession('s1')
  applied.setSession('s2')
  let tree = applied.render()
  buttons(tree)[0].props.onClick()
  tree = applied.render()
  buttons(tree)[1].props.onClick()
  assert.deepEqual(applied.opened, ['s1', 's2'])
})

await check('a new external navigation truncates forward history', async () => {
  const applied = scenario()
  applied.setSession('s1')
  applied.setSession('s2')
  let tree = applied.render()
  buttons(tree)[0].props.onClick()
  applied.setSession('s9')
  tree = applied.render()
  const [back, forward] = buttons(tree)
  assert.equal(forward.props.disabled, true, 'new branch has no forward entry')
  back.props.onClick()
  assert.deepEqual(applied.opened, ['s1', 's1'])
})

await check('Alt+Left and Alt+Right trigger navigation', async () => {
  const applied = scenario()
  applied.setSession('s1')
  applied.setSession('s2')
  applied.render()
  const keydown = applied.listeners.get('keydown')
  keydown({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'ArrowLeft', preventDefault() {} })
  keydown({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'ArrowRight', preventDefault() {} })
  assert.deepEqual(applied.opened, ['s1', 's2'])
})

await check('caption controls keep their seats while no session is known', () => {
  const applied = scenario()
  const controls = buttons(applied.render())
  assert.equal(controls.length, 2)
  assert(controls.every((control) => control.props.disabled))
})

await check('an older failed navigation cannot rewind a newer successful navigation', async () => {
  let rejectFirst
  const applied = scenario({ openSession: (id) => id === 's2' ? new Promise((_resolve, reject) => { rejectFirst = reject }) : Promise.resolve() })
  applied.setSession('s1'); applied.setSession('s2'); applied.setSession('s3')
  applied.nav.back(); applied.nav.back(); applied.setSession('s1')
  rejectFirst(new Error('late refusal'))
  await Promise.resolve()
  assert.equal(applied.nav.getSnapshot().index, 0)
  assert.equal(applied.nav.getSnapshot().canBack, false)
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
