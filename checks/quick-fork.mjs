/**
 * Zero-dependency verification for the merged quick-fork feature.
 *
 * Run with `node checks/quick-fork.mjs`. The shipped browser bundle is loaded
 * with only this feature built (the bundle's test filter), which exposes the
 * feature's `__test` hooks on the merged module; tests cover the factories,
 * parameter parsing, transcript mapping and the selection gate.
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
  try { await body(); checks += 1; console.log('ok ' + name) }
  catch (error) { console.error('FAIL ' + name); console.error('     ' + (error?.message ?? error)); process.exitCode = 1 }
}

/** Load the merged module with only quick-fork built and a minimal DOM/localStorage sandbox. */
function load(feature = 'dsh-quick-fork', seedStorage = {}) {
  const storage = new Map(Object.entries(seedStorage))
  let sequence = 0
  let loaded
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: [feature],
    window: { __ModuleLoader__: { load(definition) { loaded = definition } }, addEventListener() {}, removeEventListener() {} },
    document: {
      addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] },
      createElement() { return { dataset: {}, appendChild() {}, remove() {} } }, head: { appendChild() {} },
    },
    localStorage: {
      get length() { return storage.size },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    crypto: { randomUUID: () => 'fixture-' + (++sequence) },
    setTimeout, clearTimeout,
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') return { createElement: () => null, useEffect() {}, useLayoutEffect() {}, useMemo: (fn) => fn(), useRef: () => ({}), useState: (value) => [value, () => {}] }
    if (id === 'react-dom') return { createPortal: (element) => element }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null, IconSparkleRegular: () => null }
    throw new Error('unexpected require ' + id)
  })
  return { plugin, storage }
}

await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.3.2')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
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

await check('sidebar tab params are parsed defensively', () => {
  const { plugin } = load()
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.__test.parseForkParams({ parentSessionId: 's1', quote: 'why?' }))),
    { parentSessionId: 's1', quote: 'why?' },
  )
  assert.equal(plugin.__test.parseForkParams(null), null)
  assert.equal(plugin.__test.parseForkParams({ quote: 'x' }), null)
  assert.equal(plugin.__test.parseForkParams({ parentSessionId: '' }), null)
})

await check('durable nodes become simple side-chat rows', () => {
  const { plugin } = load()
  const rows = plugin.__test.nodesToMessages({
    nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'hello' }] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'hi' }, { kind: 'reasoning', text: 'think' }] },
      { kind: 'tool-result', seq: 3, content: [{ type: 'text', text: 'tool output' }] },
      { kind: 'turn-error', seq: 4, message: 'boom' },
    ],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { key: 'u1', role: 'user', text: 'hello' },
    { key: 'a2', role: 'assistant', text: 'hi' },
    { key: 't3', role: 'tool', text: 'tool output' },
    { key: 'e4', role: 'error', text: 'boom' },
  ])
})

await check('inherited parent history can be hidden behind the fork baseline', () => {
  const { plugin } = load()
  const snapshot = {
    nodes: [
      { kind: 'user', seq: 3, content: [{ type: 'text', text: 'parent' }] },
      { kind: 'assistant', seq: 4, blocks: [{ kind: 'text', text: 'inherited' }] },
      { kind: 'user', seq: 9, content: [{ type: 'text', text: 'side' }] },
    ],
  }
  assert.equal(plugin.__test.maxSeqOf(snapshot), 9)
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.__test.nodesToMessages(snapshot, 4))),
    [{ key: 'u9', role: 'user', text: 'side' }],
  )
})

await check('tab definition is multi-instance and has a title', () => {
  const { plugin } = load()
  const definition = plugin.__test.tabDefinitionFor((key) => key)
  assert.equal(definition.id, 'dsh-quick-fork')
  assert.equal(definition.kind, 'quick-fork')
  assert.equal(definition.multiple, true)
  assert.equal(definition.title(), 'tab.title')
})

await check('the selected passage is included in the first prompt only', () => {
  const { plugin } = load()
  assert.equal(plugin.__test.composePrompt('why?', 'line one\nline two', false), '> line one\n> line two\n\nwhy?')
  assert.equal(plugin.__test.composePrompt('why?', 'line one', true), 'why?')
  assert.equal(plugin.__test.composePrompt('why?', '   ', false), 'why?')
})

await check('selected text becomes a Markdown quote block', () => {
  const { plugin } = load()
  assert.equal(plugin.__test.quoteBlockOf('  line one\nline two  '), '> line one\n> line two')
  assert.equal(plugin.__test.quoteBlockOf('   '), '')
  assert.equal(plugin.__test.quoteBlockOf(null), '')
})

await check('selected text becomes numbered model context', () => {
  const { plugin } = load('dsh-selection-quotes')
  assert.equal(plugin.__test.annotationContextOf([]), '')
  assert.equal(
    plugin.__test.annotationContextOf([{ text: 'one' }, { text: '  two  ' }]),
    'Selected text 1:\none\n\nSelected text 2:\ntwo',
  )
})

await check('annotation store adds, removes and persists per session', () => {
  const { plugin, storage } = load('dsh-selection-quotes')
  assert.equal(plugin.__test.addAnnotation('s1', 'alpha'), true)
  assert.equal(plugin.__test.addAnnotation('s1', '   '), false)
  assert.equal(plugin.__test.annotationItemsOf('s1').length, 1)
  assert.equal(plugin.__test.annotationItemsOf('s2').length, 0)
  const id = plugin.__test.annotationItemsOf('s1')[0].id
  assert.equal(plugin.__test.removeAnnotation('s1', id), true)
  assert.equal(plugin.__test.annotationItemsOf('s1').length, 0)
  assert.equal(storage.has('dsh.quickFork.annotations'), false)
})

await check('pending annotations ride on the next prompt and clear on success', async () => {
  const { plugin } = load('dsh-selection-quotes')
  const calls = []
  const session = {
    async prompt(content, mode) {
      calls.push({ content: JSON.parse(JSON.stringify(content)), mode })
      return { ok: true }
    },
  }
  const ctx = { sessions: { binding: (id) => (id === 's1' ? { session } : undefined) } }
  plugin.__test.addAnnotation('s1', 'selected passage')
  plugin.__test.ensureAnnotationPromptWrapper(ctx, 's1')
  const result = await session.prompt([{ type: 'text', text: 'hello' }], 'queue')
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].content.length, 2)
  assert.equal(calls[0].content[0].text, 'Selected text 1:\nselected passage')
  assert.equal(calls[0].content[1].text, 'hello')
  assert.equal(plugin.__test.annotationItemsOf('s1').length, 0)
  const again = await session.prompt([{ type: 'text', text: 'second' }], 'queue')
  assert.equal(again.ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].content.length, 1)
  assert.equal(calls[1].content[0].text, 'second')
})

await check('a rejected prompt restores the annotations', async () => {
  const { plugin } = load('dsh-selection-quotes')
  const session = {
    async prompt() {
      return { ok: false, error: { code: 'test', message: 'rejected' } }
    },
  }
  const ctx = { sessions: { binding: () => ({ session }) } }
  plugin.__test.addAnnotation('s2', 'keep me')
  plugin.__test.ensureAnnotationPromptWrapper(ctx, 's2')
  const result = await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
  assert.equal(result.ok, false)
  assert.equal(plugin.__test.annotationItemsOf('s2').length, 1)
})

await check('failed sends preserve quotes added while the send was pending, including across reload', () => {
  const { plugin, storage } = load('dsh-selection-quotes')
  for (let i = 0; i < 12; i++) plugin.__test.addAnnotation('s1', 'old ' + i)
  const pending = [...plugin.__test.annotationItemsOf('s1')]
  plugin.__test.forgetAnnotations('s1', pending)
  for (let i = 0; i < 12; i++) plugin.__test.addAnnotation('s1', 'new ' + i)
  plugin.__test.restoreAnnotations('s1', pending)
  assert.equal(plugin.__test.annotationItemsOf('s1').length, 24)
  const restored = load('dsh-selection-quotes', { 'dsh.quickFork.annotations': storage.get('dsh.quickFork.annotations') })
  assert.equal(restored.plugin.__test.annotationItemsOf('s1').length, 24)
})

await check('selection capsule and composer annotation layer are present', () => {
  assert(clientSource.includes('dsh-selection-toolbar'))
  assert(clientSource.includes("'bubble.addToChat'"))
  assert(clientSource.includes("'bubble.addToTempChat'"))
  assert(clientSource.includes('dshqf-annotationPanel'))
  assert(clientSource.includes('ensureAnnotationPromptWrapper'))
  assert.equal(clientSource.includes('dshqf-bubble'), false)
})

await check('the side chat is listed in the right-sidebar guide', () => {
  const { plugin } = load()
  const definition = plugin.__test.tabDefinitionFor((key) => key)
  assert.equal(definition.guide.length, 1)
  assert.equal(definition.guide[0].id, 'new')
  assert.equal(definition.guide[0].title(), 'guide.title')
  assert.equal(definition.guide[0].description(), 'guide.description')
  assert.equal(typeof definition.guide[0].icon, 'function')
})

await check('selection tools ignore content outside a conversation and editable surfaces', () => {
 const {plugin}=load('dsh-selection-toolbar')
 const owner={getAttribute:()=> 's1'}
 const content={closest:selector=>selector==='[data-conversation-session]'?owner:null}
 const editable={closest:selector=>selector.includes('contenteditable')?{}:owner}
 assert.equal(plugin.__test.ownerOf(content),owner)
 assert.equal(plugin.__test.ownerOf(editable),null)
 assert.equal(plugin.__test.ownerOf(null),null)

})

await check('factory exposes apply and the expected injected services', () => {
  const { plugin } = load()
  assert.equal(typeof plugin.apply, 'function')
  assert(plugin.inject.includes('sessions'))
  assert(plugin.inject.includes('slots'))
  assert(plugin.inject.includes('locale'))
})

await check('close cleanup persists synchronously and recovers after a reload', async () => {
  const seed = { 'dsh.quickFork.tab.closed': JSON.stringify({ childId: 'child', parentSessionId: 'parent', closing: true }) }
  const first = load('dsh-quick-fork', seed)
  const ctx = { get: (name) => name === 'workspaces' ? { archiveSession: async () => { throw new Error('offline') } } : undefined }
  const queue = first.plugin.__test.createCleanupQueue(ctx)
  const stop = queue.start()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  stop()
  assert.equal(JSON.parse(first.storage.get('dsh.quickFork.tab.closed')).closing, true)
  const restored = load('dsh-quick-fork', Object.fromEntries(first.storage))
  const archived = []
  const recovered = restored.plugin.__test.createCleanupQueue({ get: (name) => name === 'workspaces'
    ? { archiveSession: async (id, options) => { archived.push([id, options.stopActivity]) } } : undefined })
  const dispose = recovered.start()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  dispose()
  assert.deepEqual(archived, [['child', true]])
  assert.equal(restored.storage.has('dsh.quickFork.tab.closed'), false)
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
