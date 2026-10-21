/** Focused continuation state-machine checks; no real sessions or network. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

let build
vm.runInNewContext(fs.readFileSync(new URL('../src/composer/continue.js', import.meta.url), 'utf8'), {
  __DSH_FEATURE: (_id, factory) => { build = factory }, AbortController, setTimeout, clearTimeout,
})
const { eligible, createController } = build(() => ({}), {}).__test
let checks = 0
async function check(name, run) {
  try { await run(); checks++; console.log('ok ' + name) }
  catch (error) { process.exitCode = 1; console.error('FAIL ' + name + '\n' + error.stack) }
}
function fixture(extra = {}) {
  const state = {
    current: true, connected: true,
    session: { openState: 'open', blank: false, running: false, removed: false, subagent: null, pendingSubmissions: [] },
    input: { phase: 'plain', draft: '', attachmentIds: [] }, events: [{ type: 'turn/end', seq: 9, data: { turn: 0, reason: { kind: 'completed' } } }], inbox: {},
  }
  const calls = [], notices = []
  let saved = extra.saved ?? null, serial = 0
  const ports = {
    read: () => state, id: () => 'request-' + ++serial,
    load: () => saved, save: (value) => { saved = value ? { ...value } : null },
    notice: (...args) => notices.push(args),
    prompt: (...args) => { calls.push(args); return extra.prompt?.(...args) ?? Promise.resolve({ ok: true }) },
    ...extra.ports,
  }
  const controller = createController(ports)
  return { state, controller, calls, notices, ports, saved: () => saved }
}
const message = (id, seq = 11) => ({ type: 'user/message', seq, data: { source: { kind: 'user', rpcId: id } } })
const start = (seq = 10) => ({ type: 'turn/start', seq, data: { turn: 1 } })
const end = (kind = 'completed', seq = 12) => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind } } })
const splice = (seq, start, removedCount, inserted = [], outcome) => ({ type: 'agent/inbox/spliced', seq, data: { target: 'next-turn', start, removedCount, inserted, outcome } })

await check('only an idle existing ordinary conversation with an empty composer qualifies', () => {
  const { state } = fixture()
  assert(eligible(state))
  for (const patch of [{ connected: false }, { current: false }, { interaction: {} }, { blocked: {} }, { quotes: true }]) {
    assert(!eligible({ ...state, ...patch }), JSON.stringify(patch))
  }
  for (const target of ['next-turn', 'next-step']) assert(!eligible({ ...state, inbox: { [target]: [{}] } }), target)
  for (const patch of [{ blank: true }, { running: true }, { removed: true }, { openState: 'error' }, { openState: 'loading' }, { awaitingFirstTurn: true }, { pendingSubmissions: [{}] }, { subagent: { address: { mode: 'continuable' }, parentAvailable: true } }]) {
    assert(!eligible({ ...state, session: { ...state.session, ...patch } }), JSON.stringify(patch))
  }
  for (const patch of [{ draft: 'next message' }, { phase: 'claimed' }, { phase: 'adjudicating' }, { phase: 'submitting' }, { attachmentIds: ['image'] }]) {
    assert(!eligible({ ...state, input: { ...state.input, ...patch } }), JSON.stringify(patch))
  }
})
await check('a continuation sends nonempty text with one stable request identity', async () => {
  const f = fixture()
  assert.equal(await f.controller.run('继续'), true)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0], '继续')
  assert.equal(f.calls[0][1], 'request-1')
  assert(f.calls[0][2] instanceof AbortSignal)
  assert.equal(f.controller.snapshot().pending, true, 'admission is not execution completion')
  assert.equal(await f.controller.run('继续'), false)
  f.state.events = [start(), message('request-1')]
  f.state.session.running = true
  f.controller.changed()
  assert(f.saved(), 'consumed request remains owned until its Turn finishes')
  assert.equal(f.controller.snapshot().available, false)
})
await check('double clicks across views share one admission latch', async () => {
  let resolve
  const f = fixture({ prompt: () => new Promise((done) => { resolve = done }) })
  const pending = f.controller.run('继续')
  assert.equal(await f.controller.run('继续'), false)
  assert.equal(f.calls.length, 1)
  resolve({ ok: false, error: { code: 'session/agent-busy' } })
  await pending
  assert.equal(f.controller.snapshot().pending, false)
})
await check('the live composer is rechecked after synchronous notification', async () => {
  const f = fixture()
  f.controller.subscribe(() => { f.state.input.draft = 'new draft' })
  assert.equal(await f.controller.run('继续'), false)
  assert.equal(f.calls.length, 0)
  assert.equal(f.state.input.draft, 'new draft')
})
await check('definitive failure permits manual retry and preserves later drafts and attachments', async () => {
  let resolve
  const f = fixture({ prompt: () => new Promise((done) => { resolve = done }) })
  const pending = f.controller.run('继续')
  f.state.input.draft = 'typed during admission'
  f.state.input.attachmentIds.push('later-image')
  resolve({ ok: false, error: { code: 'session/model-unavailable' } })
  assert.equal(await pending, false)
  assert.equal(f.saved(), null)
  assert.equal(f.state.input.draft, 'typed during admission')
  assert.deepEqual(f.state.input.attachmentIds, ['later-image'])
  assert.deepEqual(f.notices, [['error', 'failed']])
})
await check('transport failure remains uncertain through reconnection and reload without resending', async () => {
  const f = fixture({ prompt: async () => ({ ok: false, error: { code: 'gateway/internal' } }) })
  assert.equal(await f.controller.run('继续'), false)
  assert.equal(f.controller.snapshot().uncertain, true)
  f.state.connected = false; f.controller.changed()
  f.state.connected = true; f.controller.changed()
  assert.equal(await f.controller.run('继续'), false)
  const restored = fixture({ saved: f.saved() })
  assert.equal(restored.controller.snapshot().uncertain, true)
  assert.equal(await restored.controller.run('继续'), false)
  assert.equal(restored.calls.length, 0)
  assert.equal(f.calls.length, 1)
  restored.state.events = [start(), message('request-1'), end('error')]
  restored.controller.changed()
  assert.equal(restored.saved(), null)
  assert.equal(restored.controller.snapshot().available, true)
})
await check('a local throw cannot be mistaken for a proven rejection', async () => {
  const f = fixture({ prompt: async () => { throw new Error('carrier disconnected') } })
  await f.controller.run('继续')
  assert.equal(f.controller.snapshot().uncertain, true)
  assert.equal(await f.controller.run('继续'), false)
})
await check('a stalled admission times out into an uncertain state and aborts its transport', async () => {
  let expire, signal
  const f = fixture({ prompt: (_text, _id, value) => { signal = value; return new Promise(() => {}) }, ports: { setTimeout: (fn) => { expire = fn; return 1 }, clearTimeout: () => {} } })
  const pending = f.controller.run('继续')
  expire()
  await pending
  assert(signal.aborted)
  assert.equal(f.controller.snapshot().pending, false)
  assert.equal(f.controller.snapshot().uncertain, true)
  assert.equal(await f.controller.run('继续'), false)
})
await check('completion and interruption both restore continue after the matching message', async () => {
  for (const kind of ['completed', 'aborted', 'error', 'max-tokens', 'interrupted', 'forked']) {
    const f = fixture()
    await f.controller.run('继续')
    f.state.events = [start(), message('request-1'), end(kind)]
    f.controller.changed()
    assert.equal(f.saved(), null, kind)
    assert.equal(f.controller.snapshot().pending, false, kind)
    assert.equal(f.controller.snapshot().available, true, kind)
  }
})
await check('another request or a local submission echo is not acceptance evidence', async () => {
  const f = fixture()
  await f.controller.run('继续')
  f.state.events = [start(), message('other'), end()]
  f.state.session.pendingSubmissions = []
  f.controller.changed()
  assert.equal(f.controller.snapshot().pending, true)
  assert(f.saved())
})
await check('a queued continuation stays owned across stop and cannot be submitted twice', async () => {
  const f = fixture()
  await f.controller.run('继续')
  const item = { id: 'queue-1', source: { rpcId: 'request-1' } }
  f.state.events = [splice(10, 0, 0, [item]), start(11)]
  f.state.inbox = { 'next-turn': [item] }
  f.state.session.running = true
  f.controller.changed()
  assert(f.saved())
  f.state.events.push(end('aborted', 12))
  f.state.session.running = false
  f.controller.changed()
  assert.equal(f.controller.snapshot().queued, true)
  assert.equal(await f.controller.run('继续'), false)
  assert.equal(f.calls.length, 1)
  f.state.events.push(splice(13, 0, 1, [], 'canceled'))
  f.state.inbox = { 'next-turn': [] }
  f.controller.changed()
  assert.equal(f.saved(), null)
})
await check('pre-step rejection or stop after claim finishes even without a user/message event', async () => {
  for (const reason of ['blocked', 'aborted', 'error', 'interrupted']) {
    const f = fixture()
    await f.controller.run('继续')
    f.state.events = [splice(10, 0, 0, [{ id: 'queue-1', source: { rpcId: 'request-1' } }]), start(11), splice(12, 0, 1), end(reason, 13)]
    f.controller.changed()
    assert.equal(f.saved(), null, reason)
  }
})
await check('queue editing, reordering, and neighboring removals preserve occurrence identity', async () => {
  const f = fixture()
  await f.controller.run('继续')
  const own = { id: 'queue-1', source: { rpcId: 'request-1' } }, other = { id: 'other', source: { rpcId: 'other' } }
  f.state.events = [splice(10, 0, 0, [own, other]), splice(11, 0, 2, [other, own], 'canceled'), splice(12, 0, 1, [], 'canceled')]
  f.controller.changed()
  assert(f.saved())
  assert.equal(f.saved().slot.index, 0)
  f.state.events.push(start(13), splice(14, 0, 1), end('aborted', 15))
  f.controller.changed()
  assert.equal(f.saved(), null)
})
await check('steering a queued request into next-step then stopping cannot create another continue', async () => {
  const f = fixture()
  await f.controller.run('继续')
  const own = { id: 'own', source: { rpcId: 'request-1' } }
  f.state.events = [splice(10, 0, 0, [own]), start(11), splice(12, 0, 1, [], 'canceled'), { type: 'agent/inbox/spliced', seq: 13, data: { target: 'next-step', start: 0, inserted: [own] } }, end('aborted', 14)]
  f.state.inbox = { 'next-turn': [], 'next-step': [own] }
  f.controller.changed()
  assert.equal(f.controller.snapshot().available, false)
  assert.equal(await f.controller.run('继续'), false)
  assert.equal(f.calls.length, 1)
})
await check('a restored unresolved request backfills its known history boundary once', async () => {
  const original = fixture()
  await original.controller.run('继续')
  let recovered = 0, f
  f = fixture({ saved: original.saved(), ports: { recover: async (seq) => {
    recovered++; assert.equal(seq, 9)
    f.state.events = [start(), message('request-1'), end('interrupted'), { type: 'turn/end', seq: 100, data: { turn: 20 } }]
  } } })
  f.state.events = [{ type: 'turn/end', seq: 100, data: { turn: 20 } }]
  f.controller.changed()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(recovered, 1)
  assert.equal(f.saved(), null)
  assert.equal(f.calls.length, 0, 'history recovery cannot resend the instruction')
})
await check('disposal ends the owned wait and suppresses late notices', async () => {
  const f = fixture({ prompt: () => new Promise(() => {}) })
  const pending = f.controller.run('继续')
  f.controller.dispose()
  await pending
  assert.equal(f.saved().phase, 'uncertain')
  assert.deepEqual(f.notices, [])
})
await check('IME and host readiness guards refuse the operation before sending', async () => {
  const f = fixture()
  assert.equal(await f.controller.run('继续', () => false), false)
  assert.equal(f.calls.length, 0)
})
console.log('\n' + (process.exitCode ? 'some checks failed' : 'all checks passed (' + checks + ')'))
