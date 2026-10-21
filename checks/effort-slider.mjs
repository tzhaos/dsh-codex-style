/** Model capability / stale-draft checks, without a gateway or provider. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

let build
vm.runInNewContext(fs.readFileSync(new URL('../src/composer/effort.js', import.meta.url), 'utf8'), {
  __DSH_FEATURE: (_id, factory) => {
    build = factory
  },
  setTimeout, clearTimeout, queueMicrotask,
})
const { describe, selectionFor, selectAndConfirm, place } = build(() => ({})).__test
const fixture = () => ({
  status: 'ready',
  pending: null,
  current: { provider: 'p', model: 'm', reasoningEffort: 'budget:42' },
  groups: [
    {
      id: 'p',
      models: [
        {
          id: 'm',
          name: 'Model',
          reasoning: {
            defaultEffort: 'budget:42',
            efforts: [
              { id: 'off', name: '关闭' },
              { id: 'budget:42', name: '标准' },
              { id: 'adaptive', name: '自适应' },
            ],
          },
        },
      ],
    },
  ],
})
let checks = 0
const check = (name, run) => {
  run()
  checks++
  console.log('ok ' + name)
}
const json = (value) => JSON.parse(JSON.stringify(value))
check('provider order, IDs and names are preserved', () => {
  const state = fixture(),
    view = describe(state, '默认')
  assert.deepEqual(json(view.levels), state.groups[0].models[0].reasoning.efforts)
  assert.equal(view.index, 1)
  assert.deepEqual(json(selectionFor(state, view.key, 2)), {
    provider: 'p',
    model: 'm',
    reasoningEffort: 'adaptive',
  })
})
check('provider default is a distinct first step only when no model default is advertised', () => {
  const state = fixture()
  delete state.groups[0].models[0].reasoning.defaultEffort
  delete state.current.reasoningEffort
  const view = describe(state, '默认')
  assert.equal(view.levels.length, 4)
  assert.equal(view.levels[0].id, undefined)
  assert.equal(view.index, 0)
  assert.equal(selectionFor(state, view.key, 0), null)
  state.current.reasoningEffort = 'adaptive'
  assert.deepEqual(json(selectionFor(state, describe(state, '').key, 0)), {
    provider: 'p',
    model: 'm',
  })
})
check('reset omits effort without changing provider or model', () => {
  const state = fixture()
  state.current.reasoningEffort = 'adaptive'
  assert.deepEqual(json(selectionFor(state, describe(state, '').key, 2, true)), {
    provider: 'p',
    model: 'm',
  })
  state.current.reasoningEffort = undefined
  assert.equal(describe(state, '').index, 1)
  assert.equal(selectionFor(state, describe(state, '').key, 1, true), null)
})
check('unavailable model or absent reasoning has no slider', () => {
  const state = fixture()
  state.current.model = 'missing'
  assert.equal(describe(state, '').levels.length, 0)
  state.current = null
  assert.equal(describe(state, '').levels.length, 0)
  state.current = { provider: 'p', model: 'm' }
  delete state.groups[0].models[0].reasoning
  assert.equal(describe(state, '').levels.length, 0)
})
check('retired effort remains unknown and can be reset without fabricating a level', () => {
  const state = fixture()
  state.current.reasoningEffort = 'retired'
  const view = describe(state, '')
  assert.equal(view.index, -1)
  assert.deepEqual(json(selectionFor(state, view.key, -1, true)), { provider: 'p', model: 'm' })
})
check('busy, stale, unchanged and out-of-range selections never submit', () => {
  const original = fixture(),
    key = describe(original, '').key
  assert.equal(selectionFor({ ...original, status: 'selecting' }, key, 2), null)
  assert.equal(selectionFor({ ...original, pending: {} }, key, 2), null)
  assert.equal(selectionFor(original, key, 1), null)
  for (const index of [-1, 99, NaN]) assert.equal(selectionFor(original, key, index), null)
  for (const change of [
    (s) => {
      s.current.model = 'another'
    },
    (s) => {
      s.current.reasoningEffort = 'off'
    },
    (s) => {
      s.groups[0].models[0].reasoning.efforts.reverse()
    },
    (s) => {
      s.groups[0].models[0].reasoning.defaultEffort = 'off'
    },
  ]) {
    const state = fixture()
    change(state)
    assert.equal(selectionFor(state, key, 2), null)
  }
})
check('background catalog refresh keeps retained choices usable like the native picker', () => {
  const state = { ...fixture(), status: 'loading' }, view = describe(state, '')
  assert.equal(view.busy, false)
  assert.deepEqual(json(selectionFor(state, view.key, 2)), {
    provider: 'p', model: 'm', reasoningEffort: 'adaptive',
  })
  state.groups = []
  assert.equal(describe(state, '').busy, true)
  assert.equal(selectionFor(state, view.key, 2), null)
})
check('one-level and arbitrary-sized catalogs retain their real capability counts', () => {
  const state = fixture(),
    reasoning = state.groups[0].models[0].reasoning
  reasoning.efforts = [{ id: 'only', name: '唯一档位' }]
  reasoning.defaultEffort = 'only'
  state.current.reasoningEffort = 'only'
  assert.equal(describe(state, '').levels.length, 1)
  reasoning.efforts = Array.from({ length: 9 }, (_, i) => ({
    id: 'custom-' + i,
    name: '档位 ' + i,
  }))
  assert.equal(describe(state, '').levels.length, 9)
})
check('popover flips and stays within the visible viewport', () => {
  const centered = place({ left: 380, right: 500, top: 700, bottom: 728 }, 260, 100, { width: 1000, height: 800 })
  assert.equal(centered.left + 130, 440)
  const bottom = place({ left: 340, right: 380, top: 700, bottom: 732 }, 320, 124, { width: 400, height: 800 })
  assert.equal(bottom.left, 68)
  assert.equal(bottom.top, 568)
  const top = place({ left: 10, right: 50, top: 20, bottom: 52 }, 320, 124, { width: 400, height: 800 })
  assert.equal(top.left, 12)
  assert.equal(top.top, 60)
  const zoomed = place({ left: 400, right: 500, top: 100, bottom: 132 }, 320, 124, {
    width: 250,
    height: 300,
    offsetLeft: 40,
    offsetTop: 80,
  })
  assert.equal(zoomed.maxWidth, 226)
  assert(zoomed.left >= 52 && zoomed.top >= 92)
})
// ModelDirectory leaves pending behind when its RPC or post-commit hook throws.
function selectionFixture(perform) {
  let state = fixture(), generation = 0, calls = 0, resets = 0, serial = 0
  const listeners = new Set(), timers = new Map()
  const store = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: (next) => { state = next; for (const listener of [...listeners]) listener() },
  }
  const directory = {
    store,
    get generation() { return generation },
    async select(selection) {
      calls++
      const revision = ++generation
      store.set({ ...state, status: 'selecting', pending: selection })
      const result = await perform(selection, store)
      if (revision === generation)
        store.set({ ...state, pending: null, status: result.ok ? 'ready' : 'error',
          ...(result.ok ? { current: selection } : {}) })
      return result
    },
    resetConnected() {
      resets++; generation++
      store.set({ ...state, pending: null, status: 'ready' })
    },
  }
  const options = {
    schedule: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id },
    unschedule: (id) => timers.delete(id),
  }
  const tick = (delay) => {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) {
      timers.delete(id); timer.callback()
    }
  }
  return { directory, options, tick, timers, listeners, calls: () => calls, resets: () => resets }
}
const target = { provider: 'p', model: 'm', reasoningEffort: 'adaptive' }
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
async function checkSelection(name, run) { await run(); checks++; console.log('ok ' + name) }

await checkSelection('normal acknowledgements keep native cleanup and submit once', async () => {
  const f = selectionFixture(async () => ({ ok: true }))
  assert.equal((await selectAndConfirm(f.directory, target, f.options)).ok, true)
  assert.equal(f.calls(), 1)
  assert.equal(f.resets(), 0)
  assert.equal(f.timers.size + f.listeners.size, 0)
})
await checkSelection('a post-commit exception recovers the accepted effort and native spinner', async () => {
  const f = selectionFixture(async (selection, store) => {
    store.set({ ...store.getSnapshot(), current: selection })
    throw new Error('post-commit analytics failed')
  })
  assert.equal((await selectAndConfirm(f.directory, target, f.options)).ok, true)
  assert.equal(f.directory.store.getSnapshot().current.reasoningEffort, 'adaptive')
  assert.equal(f.directory.store.getSnapshot().pending, null)
  assert.equal(f.resets(), 1)
})
await checkSelection('transport rejection preserves the accepted value without resubmission', async () => {
  const f = selectionFixture(async () => { throw new Error('transport failed') })
  const result = await selectAndConfirm(f.directory, target, f.options)
  assert.equal(result.unknown, true)
  assert.equal(f.directory.store.getSnapshot().current.reasoningEffort, 'budget:42')
  assert.equal(f.directory.store.getSnapshot().pending, null)
  assert.equal(f.calls(), 1)
})
await checkSelection('a confirmed frame settles a lost acknowledgement and ignores its late failure', async () => {
  let reject
  const f = selectionFixture((selection, store) => {
    store.set({ ...store.getSnapshot(), current: selection })
    return new Promise((_, fail) => { reject = fail })
  })
  const outcome = selectAndConfirm(f.directory, target, f.options)
  await flush()
  assert(![...f.timers.values()].some((timer) => timer.delay === 250), 'a durable confirmation has no extra delay')
  assert.equal((await outcome).ok, true)
  assert.equal(f.directory.store.getSnapshot().pending, null)
  reject(new Error('late failure')); await flush()
  assert.equal(f.directory.store.getSnapshot().current.reasoningEffort, 'adaptive')
  assert.equal(f.timers.size + f.listeners.size, 0)
})
await checkSelection('an unconfirmed timeout recovers without claiming success or retrying', async () => {
  const f = selectionFixture(() => new Promise(() => {}))
  const outcome = selectAndConfirm(f.directory, target, f.options)
  f.tick(15000)
  const result = await outcome
  assert.equal(result.ok, false)
  assert.equal(result.unknown, true)
  assert.equal(f.directory.store.getSnapshot().pending, null)
  assert.equal(f.directory.store.getSnapshot().current.reasoningEffort, 'budget:42')
  assert.equal(f.calls(), 1)
  assert.equal(f.timers.size + f.listeners.size, 0)
})
await checkSelection('disconnect cleanup leaves a newer identical native selection untouched', async () => {
  const f = selectionFixture(() => new Promise(() => {})), controller = new AbortController()
  const outcome = selectAndConfirm(f.directory, target, { ...f.options, signal: controller.signal })
  const newer = { ...target }
  void f.directory.select(newer)
  controller.abort()
  assert.equal((await outcome).cancelled, true)
  assert.deepEqual(f.directory.store.getSnapshot().pending, newer)
  assert.equal(f.resets(), 0)
  assert.equal(f.timers.size + f.listeners.size, 0)
})
await checkSelection('implicit default projection confirms an explicit default reset', async () => {
  const f = selectionFixture((_selection, store) => {
    store.set({ ...store.getSnapshot(), current: { provider: 'p', model: 'm' } })
    return new Promise(() => {})
  })
  const outcome = selectAndConfirm(f.directory, { ...target, reasoningEffort: 'budget:42' }, f.options)
  await flush()
  assert.equal((await outcome).ok, true)
  assert.equal(f.directory.store.getSnapshot().pending, null)
})
console.log(checks + ' effort checks passed')
