/**
 * Zero-dependency verification for the merged tab-middle-click feature.
 *
 * Run with `node scripts/check.mjs`. The suite loads the real browser module
 * against the merged bundle (only this feature is built) and a DOM-shaped fake, and\n * drives the document-level listeners directly.
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

/** Fake element with the subset of the DOM the plugin reads. */
class FakeElement {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.attributes = new Map()
    this.textContent = ''
    this.parentElement = null
    this.clicks = 0
  }
  append(child) { child.parentElement = this; this.children.push(child); return child }
  setAttribute(name, value) { this.attributes.set(name, value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  closest(selector) {
    const names = selector.split(',').map((entry) => entry.trim())
    let node = this
    while (node !== null) {
      if (names.some((name) => node.tag === name || node.hasAttribute(name.replace(/^\[|\]$/g, '')))) return node
      node = node.parentElement
    }
    return null
  }
  querySelectorAll(selector) {
    const found = []
    const walk = (node) => {
      for (const child of node.children) {
        if (selector === 'button, [role="button"]' && (child.tag === 'button' || child.hasAttribute('role'))) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }
  querySelector(selector) {
    if (selector === '[class*="close" i]') {
      const walk = (node) => {
        for (const child of node.children) {
          if ((child.className ?? '').toLowerCase().includes('close')) return child
          const nested = walk(child)
          if (nested !== null) return nested
        }
        return null
      }
      return walk(this)
    }
    return this.querySelectorAll(selector)[0] ?? null
  }
  click() { this.clicks += 1 }
}

/** One dock tab fixture. */
function tabFixture(kind = 'close') {
  const tab = new FakeElement('div')
  tab.setAttribute('data-dockkit-tab', '')
  const close = new FakeElement('button')
  if (kind === 'aria') close.setAttribute('aria-label', '关闭')
  if (kind === 'title') close.setAttribute('title', 'Close')
  if (kind === 'class') close.className = 'dock-close-button'
  if (kind !== 'none') tab.append(close)
  return { tab, close }
}

/** Install document-level listeners through the plugin overlay component. */
function scenario(kind = 'close') {
  const listeners = new Map()
  const document = {
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
  }
  const registrations = []
  const effects = []
  const componentCleanups = []
  const ctx = {
    effect(factory) { effects.push(factory()) },
    slots: {
        register(options, component) { registrations.push({ options, component }); return () => {} },
        inject(name, callback) { return callback() },
      },
  }
  let loaded
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-tab-middle-click'],
    window: { __ModuleLoader__: { load(definition) { loaded = definition } } },
    document,
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') {
      return {
        createElement: () => null,
        useEffect(effect) {
          const cleanup = effect()
          if (typeof cleanup === 'function') componentCleanups.push(cleanup)
        },
      }
    }
    throw new Error('unexpected require ' + id)
  })
  plugin.apply(ctx)
  const registration = registrations[0]
  // Mount the overlay so its useEffect installs the document listeners.
  registration.component()
  return { listeners, effects, componentCleanups, registration, ...tabFixture(kind) }
}

/** Dispatch one synthetic event through the installed listener. */
function emit(listeners, type, target, button) {
  const event = {
    button,
    target,
    composedPath: () => [target],
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
  }
  listeners.get(type)?.(event)
  return event
}

// ---------------------------------------------------------------------------
// Static contract
// ---------------------------------------------------------------------------

await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.3.4')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.equal(manifest.scripts.check, 'node scripts/check.mjs')
})

await check('all manifest files exist on disk', () => {
  for (const relative of [
    manifest.main, 'client.js', manifest.dsh.bundle.patch,
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.en.md',
    'CHANGELOG.md', 'LICENSE',
  ]) assert(fs.existsSync(path.join(ROOT, relative)), relative + ' exists')
})

await check('bundle patch inserts exactly one tab-middle-click row', () => {
  const patch = read('cordis.patch.yml')
  assert(patch.includes('- insert:'))
  assert(patch.includes('id: codex-style'))
  assert(patch.includes("name: 'dsh-codex-style'"))
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

await check('merged bundle only requires platform modules', () => {
  const requires = [...new Set([...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]))].sort()
  assert.deepEqual(requires, ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives', 'react', 'react-dom'])
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

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

await check('factory registers one global overlay', () => {
  const applied = scenario()
  assert.equal(applied.registration.options.name, 'shell.overlay')
  assert.equal(applied.registration.options.id, 'tab-middle-click.overlay')
})

await check('middle-click closes a tab through its aria-labelled close button', () => {
  const applied = scenario('aria')
  const event = emit(applied.listeners, 'auxclick', applied.tab, 1)
  assert.equal(applied.close.clicks, 1)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.propagationStopped, true)
})

await check('middle-click also accepts title and class close controls', () => {
  for (const kind of ['title', 'class']) {
    const applied = scenario(kind)
    emit(applied.listeners, 'auxclick', applied.tab, 1)
    assert.equal(applied.close.clicks, 1, kind + ' close control')
  }
})

await check('non-middle buttons do not close the tab', () => {
  const applied = scenario()
  emit(applied.listeners, 'auxclick', applied.tab, 2)
  assert.equal(applied.close.clicks, 0)
})

await check('a tab without a close control is left alone', () => {
  const applied = scenario('none')
  emit(applied.listeners, 'auxclick', applied.tab, 1)
  assert.equal(applied.close.clicks, 0)
})

await check('middle mousedown is prevented over a tab but not elsewhere', () => {
  const applied = scenario()
  const overTab = emit(applied.listeners, 'mousedown', applied.tab, 1)
  assert.equal(overTab.defaultPrevented, true)
  const outside = emit(applied.listeners, 'mousedown', new FakeElement('div'), 1)
  assert.equal(outside.defaultPrevented, false)
})

await check('overlay cleanup removes both listeners', () => {
  const applied = scenario()
  const cleanup = applied.componentCleanups[0]
  cleanup()
  assert.equal(applied.listeners.size, 0)
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
