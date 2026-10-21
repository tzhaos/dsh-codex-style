/** The cross-area seam has no DOM, host-service or framework dependencies. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const env = {}
const errors = []
vm.runInNewContext(fs.readFileSync(new URL('../src/shared/selection-actions.js', import.meta.url), 'utf8'), { env, console: { error: (...args) => errors.push(args) } })
const registry = env.selectionActions
let checks = 0
async function check(name, run) { try { await run(); checks++; console.log('ok ' + name) } catch (error) { process.exitCode = 1; console.error('FAIL ' + name + '\n     ' + error.stack) } }
await check('content actions depend on providers rather than importing their areas', async () => {
  const context = { sessionId: 's1', text: 'passage' }
  const calls = []
  const quote = registry.register({ id: 'quote', order: 10, run: (value) => { calls.push(value); assert(Object.isFrozen(value)); return true } })
  const side = registry.register({ id: 'side', order: 20, run: () => true })
  assert.equal(registry.available(context).map((action) => action.id).join(','), 'quote,side')
  assert.equal(await registry.invoke('quote', context), true)
  assert.equal(calls[0].sessionId, 's1'); assert.equal(calls[0].text, 'passage')
  side(); assert.equal(registry.available(context).length, 1)
  assert.equal(await registry.invoke('side', context), false)
  quote(); assert.equal(registry.available(context).length, 0)
})
await check('provider availability is rechecked after a selection toolbar opens', async () => {
  let enabled = true; let calls = 0
  const off = registry.register({ id: 'dynamic', supports: () => enabled, run: () => { calls++; return true } })
  assert.equal(registry.available({}).length, 1)
  enabled = false
  assert.equal(await registry.invoke('dynamic', {}), false); assert.equal(calls, 0)
  off()
})
await check('one failing provider cannot remove another provider', async () => {
  const good = registry.register({ id: 'healthy', run: () => true })
  const bad = registry.register({ id: 'broken', run: () => { throw new Error('provider failed') } })
  assert.equal(await registry.invoke('broken', {}), false)
  assert.equal(await registry.invoke('healthy', {}), true)
  assert.equal(errors.length, 1)
  bad(); good()
})
await check('unregister and subscription cleanup are idempotent', () => {
  let changes = 0
  const unsubscribe = registry.subscribe(() => changes++)
  const off = registry.register({ id: 'owned', run: () => true })
  off(); off(); assert.equal(changes, 2)
  unsubscribe(); const next = registry.register({ id: 'next', run: () => true }); next()
  assert.equal(changes, 2)
})
console.log('\n' + (process.exitCode ? 'some checks failed' : 'all checks passed (' + checks + ')'))
