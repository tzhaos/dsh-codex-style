/**
 * Zero-dependency verification for the merged long-paste feature.
 *
 * Run with `node checks/long-paste.mjs`. The suite loads the shipped browser
 * bundle with only this feature built (the bundle's test filter), drives the
 * document-level paste listener against DOM-shaped fakes with a stub Host
 * pasteboard route, and reads the merged manifest contract.
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
const featureSource = read('src/composer/long-paste.js')
const hostIndex = read('index.js')
const hostPasteboard = read('host/pasteboard.js')

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

const tick = () => new Promise((resolve) => setImmediate(resolve))

function translator(dictionary) {
  return (key) => dictionary[key] ?? key
}

// Pure helpers from the feature source (mention quoting and chip building).
let buildFeature
vm.runInNewContext(featureSource, { __DSH_FEATURE: (_id, factory) => { buildFeature = factory } })
const helpers = buildFeature(() => ({}), {}).__test
const NO_SPACE_PATH = 'C:\\temp\\pasted-text.txt'

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
  const added = []
  const notices = []
  const draftWrites = []
  const fetchCalls = []
  const document = {
    body: {},
    head: { appendChild() {} },
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
    createElement: () => ({ dataset: {}, remove() {}, addEventListener() {}, setAttribute() {} }),
  }
  const shell = {
    addFiles(references, ids) {
      if (options.refuseFiles === true) return false
      added.push({ references, ids })
      return true
    },
    actions: options.noSetDraft === true ? {} : { setDraft(text) { draftWrites.push(text) } },
    notify(level, text) { notices.push({ level, text }) },
    snapshot: { phase: options.phase ?? 'plain', draft: options.draft ?? '' },
  }
  const conversation = { input: { for: () => shell } }
  const scope = { get: (name) => name === 'conversation' ? conversation : undefined }
  const sessions = { scope: () => scope }
  const registrations = []
  const response = options.response ?? {
    ok: true,
    path: options.path ?? 'C:\\Users\\Tester\\.dsh\\dsh-codex-style\\pasteboard\\Pasted text (2,000 chars) 1.txt',
    name: options.name ?? 'Pasted text (2,000 chars) 1.txt',
  }
  const fetchImpl = options.fetch ?? (async (url, init) => {
    fetchCalls.push({ url, init })
    return { ok: true, async json() { return response } }
  })
  let loaded
  vm.runInNewContext(clientSource, {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-long-paste'],
    window: { __ModuleLoader__: { load(definition) { loaded = definition } } },
    document,
    fetch: fetchImpl,
    console,
  })
  const plugin = loaded.factory(() => ({
    createElement: () => null,
    useEffect(effect) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }))
  let locale
  const ctx = {
    effect(factory) { factory(); return () => {} },
    sessions,
    locale: {
      register(ns, dicts) { locale = { ns, dicts }; return () => {} },
      bind() { return translator(locale.dicts.zh) },
    },
    slots: {
      register(registrationOptions, component) {
        registrations.push({ options: registrationOptions, component })
        return () => {}
      },
      inject(name, callback) { return callback() },
    },
  }
  plugin.apply(ctx)
  const registration = registrations[0]
  const injected = registration.options.inject('session-a')
  const t = translator(locale.dicts.zh)
  registration.component({ ...injected, t })
  return { listeners, cleanups, added, notices, draftWrites, fetchCalls, injected, t, shell }
}

function pasteEvent(target, text, { files = [] } = {}) {
  return {
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
}

// Static contract
await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.3.4')
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

await check('the Host half owns one temporary pasteboard route', () => {
  assert(hostIndex.includes("from './host/pasteboard.js'"))
  assert(hostIndex.includes('createPasteboard()'))
  assert(hostIndex.includes('PASTEBOARD_PATH'))
  assert(hostPasteboard.includes("'/dsh-codex-style/pasteboard'"))
  assert(hostPasteboard.includes('clearPasteboard'))
  assert(hostPasteboard.includes('prunePasteboard'))
  assert(hostPasteboard.includes('MAX_FILES = 100'))
  assert(hostPasteboard.includes('MAX_TEXT_BYTES'))
})

// Behaviour
await check('a long paste is saved by the Host and inserted as a file reference', async () => {
  const applied = scenario()
  const text = 'x'.repeat(2000)
  const event = pasteEvent(makeTarget(), text)
  applied.listeners.get('paste')(event)
  await tick()
  assert.equal(event.prevented, true, 'default paste suppressed')
  assert.equal(event.immediateStopped, true, 'the editor never sees the paste')
  assert.equal(applied.fetchCalls.length, 1, 'one pasteboard write')
  assert.equal(applied.fetchCalls[0].url, '/dsh-codex-style/pasteboard')
  assert.equal(applied.fetchCalls[0].init.method, 'POST')
  assert.equal(JSON.parse(applied.fetchCalls[0].init.body).text, text)
  assert.equal(applied.added.length, 1, 'one composer insertion')
  assert.equal(applied.added[0].ids.length, 0, 'no uploaded attachment ids')
  const reference = applied.added[0].references[0]
  assert.equal(reference.source, 'reference')
  assert.equal(reference.appearance, 'file')
  assert.equal(reference.label, 'Pasted text (2,000 chars) 1.txt')
  assert(reference.ref.startsWith('@"'), 'paths with spaces are quoted: ' + reference.ref)
  assert.equal(reference.clipboardText, reference.ref)
})

await check('a path without spaces keeps the plain mention spelling', async () => {
  const applied = scenario({ path: NO_SPACE_PATH, name: 'pasted-text.txt' })
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'y'.repeat(2000)))
  await tick()
  const reference = applied.added[0].references[0]
  assert.equal(reference.ref, '@' + NO_SPACE_PATH)
  assert.equal(reference.label, 'pasted-text.txt')
})

await check('a missing file name falls back to the final path segment', async () => {
  const applied = scenario({ path: NO_SPACE_PATH, name: undefined, response: { ok: true, path: NO_SPACE_PATH } })
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'y'.repeat(2000)))
  await tick()
  assert.equal(applied.added[0].references[0].label, 'pasted-text.txt')
})

await check('short paste keeps the normal inline editor behaviour', async () => {
  const applied = scenario()
  const event = pasteEvent(makeTarget(), 'x'.repeat(1999))
  applied.listeners.get('paste')(event)
  await tick()
  assert.equal(event.prevented, false)
  assert.equal(applied.fetchCalls.length, 0)
  assert.equal(applied.added.length, 0)
})

await check('paste outside the composer is ignored', async () => {
  const applied = scenario()
  applied.listeners.get('paste')(pasteEvent(makeTarget({ editable: false }), 'x'.repeat(3000)))
  await tick()
  assert.equal(applied.fetchCalls.length, 0)
})

await check('paste from another conversation is ignored', async () => {
  const applied = scenario()
  applied.listeners.get('paste')(pasteEvent(makeTarget({ sessionId: 'session-b' }), 'x'.repeat(3000)))
  await tick()
  assert.equal(applied.fetchCalls.length, 0)
})

await check('clipboard files keep the Host upload path', async () => {
  const applied = scenario()
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'x'.repeat(3000), { files: [{}] }))
  await tick()
  assert.equal(applied.fetchCalls.length, 0)
})

await check('long paste inside the queue editor is ignored', async () => {
  const applied = scenario()
  applied.listeners.get('paste')(pasteEvent(makeTarget({ queueDock: true }), 'x'.repeat(3000)))
  await tick()
  assert.equal(applied.fetchCalls.length, 0)
})

await check('busy admission leaves the paste to the editor', async () => {
  const applied = scenario({ phase: 'submitting' })
  const event = pasteEvent(makeTarget(), 'x'.repeat(3000))
  applied.listeners.get('paste')(event)
  await tick()
  assert.equal(event.prevented, false)
  assert.equal(applied.fetchCalls.length, 0)
})

await check('a failed Host write puts the text back inline instead of losing it', async () => {
  const applied = scenario({ fetch: async () => { throw new Error('offline') } })
  const text = 'z'.repeat(2000)
  const event = pasteEvent(makeTarget(), text)
  applied.listeners.get('paste')(event)
  await tick()
  assert.equal(event.prevented, true)
  assert.equal(applied.added.length, 0)
  assert.deepEqual(applied.draftWrites, [text], 'the suppressed paste is restored')
  assert.equal(applied.notices.length, 0)
})

await check('a rejected Host response also restores the text inline', async () => {
  const applied = scenario({ response: { ok: false } })
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'w'.repeat(2000)))
  await tick()
  assert.equal(applied.draftWrites.length, 1)
  assert.equal(applied.added.length, 0)
})

await check('a composer that refuses the reference restores the text inline', async () => {
  const applied = scenario({ refuseFiles: true })
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'v'.repeat(2000)))
  await tick()
  assert.equal(applied.added.length, 0)
  assert.equal(applied.draftWrites.length, 1)
})

await check('without an inline fallback a failed paste reports a localized error', async () => {
  const applied = scenario({ fetch: async () => { throw new Error('offline') }, noSetDraft: true })
  applied.listeners.get('paste')(pasteEvent(makeTarget(), 'u'.repeat(2000)))
  await tick()
  assert.equal(applied.notices.length, 1)
  assert.equal(applied.notices[0].level, 'error')
  assert.equal(applied.notices[0].text, applied.t('toast.failed'))
})

await check('cleanup removes the paste listener', () => {
  const applied = scenario()
  applied.cleanups[0]()
  assert.equal(applied.listeners.size, 0)
})

await check('the feature no longer creates browser draft uploads', () => {
  assert(!featureSource.includes('createDrafts'), 'no draft upload path')
  assert(!featureSource.includes('new File('), 'no browser File bridge')
  assert(!featureSource.includes('dshlp-show'), 'no custom card decoration')
  assert(featureSource.includes('PASTEBOARD_PATH'), 'Host pasteboard route is used')
  assert(featureSource.includes('addFiles'), 'native composer insertion is used')
})

await check('helpers quote mentions and build the reference chip', () => {
  assert.equal(helpers.mentionOf(NO_SPACE_PATH), '@' + NO_SPACE_PATH)
  assert.equal(helpers.mentionOf('C:\\A B\\x.txt'), '@"C:\\A B\\x.txt"')
  assert.equal(helpers.labelOf('C:\\A B\\x.txt'), 'x.txt')
  const built = helpers.referenceOf({ path: 'C:\\A B\\x.txt', name: 'x.txt' })
  assert.equal(built.mention, '@"C:\\A B\\x.txt"')
  assert.deepEqual({ ...built.reference }, {
    source: 'reference',
    ref: '@"C:\\A B\\x.txt"',
    label: 'x.txt',
    appearance: 'file',
    clipboardText: '@"C:\\A B\\x.txt"',
  })
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
