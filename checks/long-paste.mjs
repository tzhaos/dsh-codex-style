/**
 * Zero-dependency verification for the merged long-paste feature.
 *
 * Run with `node checks/long-paste.mjs`. The suite loads the shipped browser
 * bundle with only this feature built (the bundle's test filter), drives the
 * document-level paste listener against DOM-shaped fakes and reads the merged
 * manifest contract.
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

/** Fake target tree: editor → conversation owner. */
function makeTarget({ sessionId = 'session-a', editable = true, queueDock = false } = {}) {
  const owner = {
    getAttribute(name) { return name === 'data-conversation-session' ? sessionId : null },
    closest(selector) { return selector === '[data-conversation-session]' ? this : null },
  }
  const target = {
    closest(selector) {
      if (selector.includes('contenteditable')) return editable ? target : null
      if (selector === '[data-conversation-session]') return owner
      if (selector === '[data-queue-dock]') return queueDock ? target : null
      return null
    },
  }
  return target
}

function scenario(options = {}) {
  const listeners = new Map()
  const cleanups = []
  const drafts = []
  const added = []
  const notices = []
  const document = {
    body: {},
    head: { appendChild() {} },
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
    createElement: () => ({ dataset: {}, textContent: '', remove() {}, addEventListener() {}, setAttribute() {}, insertAdjacentElement() {} }),
    querySelectorAll: () => [],
    querySelector: () => null,
  }
  const draft = { value: '' }
  const removed = []
  const released = []
  const shell = {
    actions: {
      addAttachments(ids) { added.push(...ids); return true },
      setDraft(text) { draft.value = text },
      removeAttachment(id) { removed.push(id) },
    },
    notify(level, text) { notices.push({ level, text }) },
    snapshot: { get draft() { return draft.value } },
  }
  const conversation = {
    input: { for: () => shell },
    releaseDraftAttachment(id) { released.push(id) },
    createDrafts(sessionId, files) {
      if (options.failDrafts === true) throw new Error('draft rejected')
      drafts.push({ sessionId, files })
      return files.map((file, index) => ({ kind: 'file', id: 'draft-' + (index + 1), file }))
    },
  }
  const scope = { get: (name) => name === 'conversation' ? conversation : undefined }
  const sessions = { scope: () => scope }
  const registrations = []
  let loaded
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-long-paste'],
    window: { __ModuleLoader__: { load(definition) { loaded = definition } } },
    document,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval: () => 1,
    clearInterval() {},
    File: class FakeFile {
      constructor(parts, name, options) {
        this.parts = parts
        this.name = name
        this.type = options?.type ?? ''
        this.size = parts?.[0]?.length ?? 0
      }
    },
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') {
      return {
        createElement: () => null,
        useEffect(effect) {
          const cleanup = effect()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
      }
    }
    throw new Error('unexpected require ' + id)
  })
  const ctx = {
    effect(factory) { factory(); return () => {} },
    sessions,
    locale: {
      register(ns, dicts) {
        return { ns, dicts }
      },
    },
    slots: {
      register(options, component) { registrations.push({ options, component }); return () => {} },
      inject(name, callback) { return callback() },
    },
  }
  // Capture dictionaries by overriding register before apply.
  let locale
  ctx.locale.register = (ns, dicts) => {
    locale = { ns, dicts }
    return () => {}
  }
  plugin.apply(ctx)
  const registration = registrations[0]
  const injected = registration.options.inject('session-a')
  const t = translator(locale.dicts.zh)
  registration.component({ ...injected, t })
  return { listeners, cleanups, drafts, added, notices, t, injected, draft, removed, released }
}

function pasteEvent(target, text, { files = [] } = {}) {
  const event = {
    target,
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    immediateStopped: false,
    clipboardData: {
      files,
      getData(type) { return type === 'text/plain' ? text : '' },
    },
    preventDefault() { this.prevented = true; this.defaultPrevented = true },
    stopPropagation() { this.stopped = true },
    stopImmediatePropagation() { this.immediateStopped = true },
  }
  return event
}

// Static contract
await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
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
await check('long composer paste becomes a text-file attachment', async () => {
  const applied = scenario()
  const text = 'x'.repeat(2000)
  const event = pasteEvent(makeTarget(), text)
  applied.listeners.get('paste')(event)
  await Promise.resolve()
  assert.equal(event.prevented, true, 'default paste suppressed')
  assert.equal(applied.drafts.length, 1, 'draft file created')
  assert.equal(applied.drafts[0].files[0].type, 'text/plain')
  assert(applied.drafts[0].files[0].name.includes('2,000'))
  assert.deepEqual(applied.added, ['draft-1'])
})

await check('short paste keeps the normal inline editor behaviour', () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget(), 'x'.repeat(1999))
  applied.listeners.get('paste')(event)
  assert.equal(event.prevented, false)
  assert.equal(applied.drafts.length, 0)
})

await check('paste outside the composer is ignored', () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget({ editable: false }), 'x'.repeat(3000))
  applied.listeners.get('paste')(event)
  assert.equal(event.prevented, false)
  assert.equal(applied.drafts.length, 0)
})

await check('paste from another conversation is ignored', () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget({ sessionId: 'session-b' }), 'x'.repeat(3000))
  applied.listeners.get('paste')(event)
  assert.equal(event.prevented, false)
  assert.equal(applied.drafts.length, 0)
})

await check('clipboard files keep the Host upload path', () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget(), 'x'.repeat(3000), { files: [{}] })
  applied.listeners.get('paste')(event)
  assert.equal(event.prevented, false)
  assert.equal(applied.drafts.length, 0)
})

await check('long paste inside the queue editor is ignored', () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget({ queueDock: true }), 'x'.repeat(3000))
  applied.listeners.get('paste')(event)
  assert.equal(event.prevented, false)
  assert.equal(applied.drafts.length, 0)
})

await check('failed attachment creation reports a localized error', async () => {
  const applied = scenario({ failDrafts: true })
  const event = pasteEvent(makeTarget(), 'x'.repeat(2000))
  applied.listeners.get('paste')(event)
  await Promise.resolve()
  assert.equal(event.prevented, true, 'default paste still suppressed')
  assert.equal(applied.notices.length, 1, 'one error notice')
  assert.equal(applied.notices[0].level, 'error')
  assert.equal(applied.notices[0].text, applied.t('toast.failed'))
})

await check('showInText replaces the attachment with the full text', async () => {
  const applied = scenario()
  const text = 'x'.repeat(2000)
  await applied.injected.actions.attach(text, applied.t('toast.failed'))
  const name = applied.drafts[0].files[0].name
  assert.equal(applied.injected.actions.showInText(name), true)
  assert.equal(applied.draft.value, text)
  assert.deepEqual(applied.removed, ['draft-1'])
  assert.deepEqual(applied.released, ['draft-1'])
  assert.equal(applied.injected.actions.showInText(name), false, 'record consumed once')
})

await check('cleanup removes the paste listener', () => {
  const applied = scenario()
  applied.cleanups[0]()
  assert.equal(applied.listeners.size, 0)
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
