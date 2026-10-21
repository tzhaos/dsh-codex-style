/** Focused removal state transitions with no real queues, providers or timers. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

let factory
vm.runInNewContext(fs.readFileSync(new URL('../src/composer/queue.js', import.meta.url), 'utf8'), {
  __DSH_FEATURE: (_id, build) => {
    factory = build
  },
})
const { createRemovalController, visibleQueue } = factory(() => ({}), {}).__test
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const item = (id) => ({
  id,
  source: { kind: 'user', rpcId: 'rpc-' + id },
  content: [{ type: 'text', text: id }],
})
function fixture(remove) {
  const state = {
    current: true,
    ready: true,
    connected: true,
    generation: {},
    inbox: { 'next-turn': [item('a'), item('b')], 'next-step': [] },
  }
  const writes = [],
    notices = [],
    timers = new Set()
  const controller = createRemovalController({
    read: () => state,
    remove: (id) => {
      writes.push(id)
      return remove?.(id) ?? Promise.resolve({ ok: true, value: { accepted: true } })
    },
    notice: (...args) => notices.push(args),
    setTimeout: (fn) => {
      timers.add(fn)
      return fn
    },
    clearTimeout: (fn) => timers.delete(fn),
  })
  const gone = (id) => {
    state.inbox['next-turn'] = state.inbox['next-turn'].filter((entry) => entry.id !== id)
    controller.changed()
  }
  return { state, controller, writes, notices, timers, gone }
}
let checks = 0
async function check(name, run) {
  await run()
  checks++
  console.log('ok ' + name)
}
await check(
  'visible rows use the native transcript-echo filter and preserve occurrence IDs',
  () => {
    const rows = [item('hidden'), item('visible'), { ...item('no-rpc'), source: { kind: 'user' } }]
    const visible = visibleQueue(rows, [
      { placement: 'transcript', requestId: 'rpc-hidden' },
      { placement: 'queued', requestId: 'rpc-visible' },
    ])
    assert.deepEqual(
      Array.from(visible, (entry) => entry.id),
      ['visible', 'no-rpc'],
    )
  },
)
await check(
  'one request survives acknowledgement until the durable queue removes the occurrence',
  async () => {
    const pending = deferred(),
      f = fixture(() => pending.promise)
    const result = f.controller.remove('a')
    assert.equal(await f.controller.remove('a'), false)
    assert.equal(await f.controller.remove('b'), false)
    pending.resolve({ ok: true, value: { accepted: true } })
    assert.equal(await result, true)
    assert.equal(f.controller.snapshot().phase, 'accepted')
    assert.equal(await f.controller.remove('a'), false)
    assert.deepEqual(f.writes, ['a'])
    f.gone('a')
    assert.equal(f.controller.snapshot(), null)
    assert.equal(f.timers.size, 0)
  },
)
await check('a durable removal arriving before its RPC response settles the owner', async () => {
  const pending = deferred(),
    f = fixture(() => pending.promise)
  const result = f.controller.remove('a')
  f.gone('a')
  pending.resolve({ ok: false, error: { code: 'gateway/disconnected' } })
  await result
  assert.equal(f.controller.snapshot(), null)
  assert.equal(f.notices.length, 0)
})
await check('missing occurrences do not invoke a backend removal', async () => {
  const f = fixture()
  assert.equal(await f.controller.remove('unknown'), false)
  assert.equal(f.writes.length, 0)
  assert.equal(f.notices[0][1], 'remove.missing')
})
await check('server failures retain their real category and allow a manual retry', async () => {
  for (const [code, key] of [
    ['session/writer-held', 'remove.writer'],
    ['session/agent-busy', 'remove.ownership'],
    ['session/queue-item-not-found', 'remove.missing'],
    ['gateway/bad-request', 'remove.failed'],
  ]) {
    const f = fixture(async () => ({ ok: false, error: { code, message: 'fixture failure' } }))
    assert.equal(await f.controller.remove('a'), false)
    assert.equal(f.controller.snapshot(), null)
    assert.equal(f.notices[0][1], key)
    assert(f.notices[0][2].includes(code))
    assert.equal(f.state.inbox['next-turn'].length, 2)
    await f.controller.remove('a')
    assert.equal(f.writes.length, 2)
  }
})
await check(
  'transport uncertainty preserves evidence without blocking manual recovery or retrying automatically',
  async () => {
    const f = fixture(async () => ({
      ok: false,
      error: { code: 'gateway/timeout', message: 'unconfirmed' },
    }))
    await f.controller.remove('a')
    assert.equal(f.controller.snapshot().phase, 'uncertain')
    assert.equal(f.notices[0][1], 'remove.unknown')
    assert.equal(f.controller.busy(), false)
    f.state.connected = false
    f.state.inbox = undefined
    f.state.ready = false
    f.controller.changed()
    assert(f.controller.snapshot(), 'missing projections during reconnect are not removal evidence')
    f.state.connected = true
    f.state.ready = true
    f.state.generation = {}
    f.state.inbox = { 'next-turn': [item('a')], 'next-step': [] }
    f.controller.changed()
    assert.equal(f.controller.snapshot(), null)
    assert.equal(f.writes.length, 1, 'reconnection must not retry automatically')
  },
)
await check(
  'a rejected promise and malformed acknowledgement do not pretend removal failed without effect',
  async () => {
    for (const remove of [
      async () => {
        throw new Error('lost reply')
      },
      async () => ({ ok: true }),
      async () => ({ ok: true, value: { accepted: false } }),
    ]) {
      const f = fixture(remove)
      await f.controller.remove('a')
      assert.equal(f.controller.snapshot().phase, 'uncertain')
      assert.equal(f.state.inbox['next-turn'].length, 2)
      f.gone('a')
      assert.equal(f.controller.snapshot(), null)
    }
  },
)
await check('the deadline releases busy controls and accepts late durable evidence', async () => {
  const pending = deferred(),
    f = fixture(() => pending.promise)
  const result = f.controller.remove('a')
  for (const timer of f.timers) timer()
  assert.equal(f.controller.snapshot().phase, 'uncertain')
  assert.equal(f.controller.busy(), false)
  f.gone('a')
  pending.resolve({ ok: true, value: { accepted: true } })
  await result
  assert.equal(f.controller.snapshot(), null)
  assert.equal(f.notices.length, 1)
})
await check(
  'binding changes and disposal suppress stale completion and release the timer',
  async () => {
    for (const invalidate of [
      (f) => {
        f.state.current = false
        f.controller.changed()
      },
      (f) => f.controller.dispose(),
    ]) {
      const pending = deferred(),
        f = fixture(() => pending.promise)
      const result = f.controller.remove('a')
      invalidate(f)
      pending.resolve({ ok: false, error: { code: 'session/writer-held' } })
      await result
      assert.equal(f.notices.length, 0)
      assert.equal(f.timers.size, 0)
    }
  },
)
await check('unready or disconnected Sessions do not mutate the queue', async () => {
  for (const key of ['current', 'ready', 'connected']) {
    const f = fixture()
    f.state[key] = false
    assert.equal(await f.controller.remove('a'), false)
    assert.equal(f.writes.length, 0)
  }
})
await check('readiness is checked again after synchronous listeners run', async () => {
  const f = fixture()
  f.controller.subscribe(() => {
    f.state.connected = false
  })
  assert.equal(await f.controller.remove('a'), false)
  assert.equal(f.writes.length, 0)
  assert.equal(f.timers.size, 0)
})
await check(
  'an explicit retry checks the live occurrence and an older reply cannot overwrite it',
  async () => {
    const first = deferred(),
      second = deferred()
    let calls = 0
    const f = fixture(() => (++calls === 1 ? first.promise : second.promise))
    const old = f.controller.remove('a')
    for (const timer of f.timers) timer()
    const retry = f.controller.remove('a')
    first.resolve({ ok: false, error: { code: 'session/writer-held' } })
    await old
    assert.equal(f.controller.snapshot().phase, 'pending')
    assert.equal(f.notices.length, 1)
    second.resolve({ ok: true, value: { accepted: true } })
    assert.equal(await retry, true)
    assert.deepEqual(f.writes, ['a', 'a'])
    f.gone('a')
    assert.equal(f.controller.snapshot(), null)
  },
)
console.log(checks + ' queue removal checks passed')
