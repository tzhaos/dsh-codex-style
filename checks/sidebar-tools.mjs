/** Pure projection, search and keyboard contract checks; no sessions or UI side effects. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { boundedPreview, createActivityPreviewProjection } from '../host/activity-preview.js'

const env = {}
vm.runInNewContext(
  fs.readFileSync(new URL('../src/navigation/sidebar-tools.js', import.meta.url), 'utf8'),
  { env },
)
const { mergeSearch, activityGroups, previewOf, matchesBinding, shortcutEntry } =
  env.createSidebarTools({}, {}, () => {})
const plain = (value) => JSON.parse(JSON.stringify(value))
const node = (id, patch = {}) => ({
  id,
  title: id,
  projectLabel: 'workspace',
  status: { state: 'idle' },
  updatedAt: 10,
  ...patch,
})
let checks = 0
function check(name, run) {
  run()
  checks++
  console.log('ok ' + name)
}
check('search merges local metadata and ranked native content without duplicates', () => {
  const nodes = [
    node('local', { updatedAt: 20 }),
    node('content'),
    node('hidden', { archived: true }),
    node('blank', { blank: true }),
  ]
  const result = mergeSearch(
    nodes,
    'local',
    {
      items: [
        { sessionId: 'content', snippet: 'actual match' },
        { sessionId: 'local', snippet: 'local body' },
        { sessionId: 'hidden', snippet: 'hidden' },
        { sessionId: 'unknown', snippet: 'unknown' },
      ],
      hasMore: false,
    },
    20,
  )
  assert.deepEqual(
    Array.from(result.items, (entry) => entry.id),
    ['local', 'content'],
  )
  assert.equal(result.items[0].snippet, 'local body')
  assert.equal(result.items[1].snippet, 'actual match')
})
check(
  'empty search shows recent chats, excludes blank/archive rows and never invents previews',
  () => {
    const result = mergeSearch(
      [node('old'), node('new', { updatedAt: 50 }), node('blank', { blank: true })],
      '',
      null,
      1,
    )
    assert.deepEqual(
      Array.from(result.items, (entry) => entry.id),
      ['new'],
    )
    assert.equal(result.items[0].snippet, undefined)
    assert.equal(result.hasMore, true)
  },
)
check('activity prioritizes real statuses then groups local calendar dates', () => {
  const now = new Date(2026, 9, 20, 12).getTime()
  const groups = activityGroups(
    [
      node('running', { status: { state: 'ongoing' }, updatedAt: now }),
      node('waiting', { status: { state: 'warning' }, updatedAt: now - 10 }),
      node('unread', { status: { state: 'done' } }),
      node('today', { updatedAt: now - 1000 }),
      node('yesterday', { updatedAt: now - 86400000 }),
      node('archived', { archived: true }),
    ],
    now,
    (key) => key,
    'en-US',
  )
  assert.deepEqual(
    Array.from(groups[0].nodes, (entry) => entry.id),
    ['waiting', 'running', 'unread'],
  )
  assert.equal(groups[1].label, 'tools.today')
  assert.equal(groups[2].label, 'tools.yesterday')
})
check('shortcut matching honors physical keys, every modifier, custom chords and repeat', () => {
  const binding = { code: 'KeyK', modifiers: ['control'] }
  assert(matchesBinding(binding, { code: 'KeyK', control: true }))
  assert(!matchesBinding(binding, { code: 'KeyK', control: true, shift: true }))
  assert(!matchesBinding(binding, { code: 'KeyK', control: true, repeat: true }))
  assert(
    matchesBinding(
      { code: 'KeyK', secondCode: 'KeyA', modifiers: ['alt'] },
      { code: 'KeyA', secondCode: 'KeyK', alt: true },
    ),
  )
  const entry = { id: 'session.search', binding, issue: null, conflicts: [] }
  assert(shortcutEntry([entry], { status: 'ready' }, entry.id))
  assert(!shortcutEntry([{ ...entry, issue: 'conflict' }], { status: 'ready' }, entry.id))
  assert(!shortcutEntry([entry], { status: 'loading' }, entry.id))
})
const projection = createActivityPreviewProjection()
const user = (text, seq = 1) => ({
  type: 'user/message',
  surfaceOp: 'append',
  seq,
  time: 10,
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
const assistant = (content, seq = 2) => ({
  type: 'assistant/message',
  surfaceOp: 'append',
  seq,
  time: 20,
  data: { message: { content } },
})
check(
  'wire preview follows genuine visible messages and ignores tools, reasoning and context replacements',
  () => {
    let state = projection.apply(projection.init(), user('question'))
    state = projection.apply(state, assistant([{ type: 'text', text: 'answer' }]))
    assert.equal(state.text, 'answer')
    assert.equal(
      projection.apply(state, assistant([{ type: 'reasoning', text: 'private reasoning' }])),
      state,
    )
    assert.equal(projection.apply(state, { ...user('rewritten'), surfaceOp: 'replace' }), state)
    const empty = projection.apply(state, user('', 3))
    assert.equal(empty.role, 'user')
    assert.equal(empty.text, '', 'an attachment prompt must not retain an old answer as current')
  },
)
check('preview extraction bounds scanning, whitespace, Unicode size and checkpoint input', () => {
  assert.equal(boundedPreview([{ type: 'text', text: '  a\n b  ' }]), 'a b')
  const text = boundedPreview([{ type: 'text', text: '😀'.repeat(5000) }])
  assert.equal([...text].length, 240)
  assert.equal(text.length, 480)
  assert.equal(
    projection.stateSchema.parse({ role: 'assistant', text, seq: 1, time: 0 }).text,
    text,
  )
  for (const value of [
    { role: 'tool', text: 'x', seq: 1, time: 0 },
    { role: 'user', text: 'x'.repeat(481), seq: 1, time: 0 },
  ])
    assert.throws(() => projection.stateSchema.parse(value))
})
check('client preview distinguishes missing, empty and real projection values', () => {
  assert.equal(previewOf({}, {}).known, false)
  assert.equal(previewOf({ projectionValues: { codexActivityPreview: null } }, {}).known, true)
  const raw = { role: 'assistant', text: 'recent answer', seq: 2, time: 20 }
  assert.deepEqual(plain(previewOf({}, { values: { codexActivityPreview: raw } })), {
    known: true,
    text: 'recent answer',
  })
})
console.log(checks + ' sidebar tools checks passed')
